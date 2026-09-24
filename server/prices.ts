import fs from "node:fs";
import path from "node:path";
import { ASSETS, PYTH_FEED_IDS } from "../shared/assets";
import type { AssetQuote, MarketSnapshot, PriceSource } from "../shared/types";
import { config } from "./config";
import type { TokenState } from "./tokenState";

export interface FeedPrice {
  price: number;
  conf: number;
  publishTime: number;
}

interface MarketHours {
  isOpen: boolean;
  nextOpen: number | null;
  nextClose: number | null;
}

/** [unix seconds, ref price, token price] sampled every HISTORY_STEP_S. */
type Sample = [number, number, number];

const HISTORY_STEP_S = 30;
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const HISTORY_KEEP_S = 3 * 86_400;
const PUBLIC_HERMES = "https://hermes.pyth.network";

const ALL_FEED_IDS = PYTH_FEED_IDS;
const XSTOCKS = ASSETS.filter((a) => a.kind === "xstock");
const PRESTOCKS = ASSETS.filter((a) => a.kind === "prestock");
const PRESTOCKS_API = "https://prestocks.com/api/prestocks";
const ALWAYS_OPEN = { isOpen: true, nextOpen: null, nextClose: null };

export class PriceService {
  source: "pyth" | "fallback" = "fallback";
  sourceNote = config.pythApiKey ? "Connecting to Pyth" : "No PYTH_API_KEY - fallback prices; live switching disabled";
  updatedAt = 0;
  private feeds = new Map<string, FeedPrice>();
  private feedSource = new Map<string, PriceSource>();
  private entitled = new Set<string>();
  private denied = 0;
  private pythError?: string;
  private hours = new Map<string, MarketHours>();
  private history = new Map<string, Sample[]>();
  private historyFile = path.join(config.dataDir, "history.json");

  constructor(private tokens: TokenState) {
    this.loadHistory();
  }

  start() {
    const tick = () => this.poll().finally(() => setTimeout(tick, config.pollMs));
    tick();
    // PreStocks rate-limits aggressive polling; back off after a 429.
    const pre = () =>
      this.pollPreStocks()
        .then(() => setTimeout(pre, 20_000))
        .catch((e) => {
          if (!String(e.message).includes("429")) console.warn("PreStocks poll failed:", e.message);
          setTimeout(pre, 60_000);
        });
    pre();
    this.pollMarketHours();
    setInterval(() => this.pollMarketHours(), 5 * 60_000);
    setInterval(() => this.sample(), HISTORY_STEP_S * 1000);
    setInterval(() => this.saveHistory(), 60_000);
    if (config.pythApiKey) {
      this.probeEntitlements().then(() => this.backfill().catch((e) => console.warn("backfill failed:", e.message)));
      setInterval(() => this.probeEntitlements(), 10 * 60_000);
    }
  }

  private pythHeaders(): Record<string, string> {
    return config.pythApiKey ? { Authorization: `Bearer ${config.pythApiKey}` } : {};
  }

  // Pyth API keys are scoped by feed grants (a key can read crypto but not US equities, say).
  // Probe each feed so we use Pyth wherever the key allows it.
  private async probeEntitlements() {
    const ok = new Set<string>();
    let denied = 0;
    for (const id of ALL_FEED_IDS) {
      try {
        const res = await fetch(`${config.pythHermesUrl}/v2/updates/price/latest?ids[]=${id}`, { headers: this.pythHeaders(), signal: AbortSignal.timeout(5_000) });
        if (res.ok) ok.add(id);
        else if (res.status === 403) denied++;
        else if (res.status === 401) {
          this.pythError = "Pyth rejected the API key (401)";
          break;
        }
      } catch {
        /* network blip: retried on the next probe */
      }
    }
    this.entitled = ok;
    this.denied = denied;
    console.log(`Pyth entitlements: ${ok.size}/${ALL_FEED_IDS.length} feeds readable${denied ? `, ${denied} not entitled` : ""}`);
  }

  private async poll() {
    let pythOk = false;
    if (this.entitled.size) {
      try {
        await this.pollPyth([...this.entitled]);
        this.pythError = undefined;
        pythOk = true;
      } catch (e) {
        this.pythError = (e as Error).message;
      }
    }
    const skip = pythOk ? this.entitled : new Set<string>();
    if (skip.size < ALL_FEED_IDS.length) {
      try {
        await this.pollFallback(skip);
      } catch (e) {
        if (!pythOk) this.sourceNote = `All price sources failing: ${(e as Error).message}`;
      }
    }
    this.describeSource();
  }

  private describeSource() {
    const refsOnPyth = XSTOCKS.filter((a) => this.feedSource.get(a.feeds.ref) === "pyth").length;
    if (!config.pythApiKey) {
      this.source = "fallback";
      this.sourceNote = "No PYTH_API_KEY - fallback prices; live switching disabled";
    } else if (this.pythError) {
      this.source = "fallback";
      this.sourceNote = `Pyth unavailable (${this.pythError}) - fallback prices; live switching disabled`;
    } else if (refsOnPyth === XSTOCKS.length) {
      this.source = "pyth";
      this.sourceNote = "Pyth Hermes";
    } else {
      this.source = "fallback";
      this.sourceNote =
        this.denied > 0
          ? `Pyth key is not entitled to ${this.denied} of ${ALL_FEED_IDS.length} feeds (US equities / xStocks). Accept those feed grants in Pyth Terminal; fallback prices fill the gap meanwhile.`
          : "Checking Pyth feed entitlements";
    }
  }

  private async pollPyth(ids: string[]) {
    const qs = ids.map((id) => `ids[]=${id}`).join("&");
    const res = await fetch(`${config.pythHermesUrl}/v2/updates/price/latest?parsed=true&ignore_invalid_price_ids=true&${qs}`, {
      headers: this.pythHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    const body = (await res.json()) as { parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
    for (const p of body.parsed) {
      const id = p.id.replace(/^0x/, "");
      const scale = 10 ** p.price.expo;
      this.feeds.set(id, { price: Number(p.price.price) * scale, conf: Number(p.price.conf) * scale, publishTime: p.price.publish_time });
      this.feedSource.set(id, "pyth");
    }
    this.updatedAt = Date.now();
  }

  // Fallback for feeds Pyth can't serve with this key: Jupiter reports both the xStock price and
  // the issuer's underlying stock price. Clearly labeled, and live execution refuses to run on it.
  private async pollFallback(skip: Set<string>) {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${XSTOCKS.map((a) => a.mint).join(",")}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Jupiter price HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, { usdPrice: number; stockData?: { price: number; updatedAt: string } }>;
    const now = Math.floor(Date.now() / 1000);
    const put = (id: string, v: FeedPrice) => {
      if (skip.has(id)) return;
      this.feeds.set(id, v);
      this.feedSource.set(id, "fallback");
    };
    for (const a of XSTOCKS) {
      const p = body[a.mint];
      if (!p) continue;
      put(a.feeds.token, { price: p.usdPrice, conf: 0, publishTime: now });
      if (p.stockData) put(a.feeds.ref, { price: p.stockData.price, conf: 0, publishTime: Math.floor(new Date(p.stockData.updatedAt).getTime() / 1000) });
      put(a.feeds.rate, { price: this.tokens.multiplier(a.ticker), conf: 0, publishTime: now });
    }
    this.updatedAt = Date.now();
  }

  // Pre-IPO references come from PreStocks: markPrice (private-market reference) and tokenPrice.
  private async pollPreStocks() {
    const res = await fetch(PRESTOCKS_API, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as { contract_address: string; markPrice: number; tokenPrice: number }[];
    const now = Math.floor(Date.now() / 1000);
    for (const a of PRESTOCKS) {
      const p = list.find((x) => x.contract_address === a.mint);
      if (!p) continue;
      for (const [id, price] of [[a.feeds.ref, p.markPrice], [a.feeds.token, p.tokenPrice], [a.feeds.rate, this.tokens.multiplier(a.ticker)]] as const) {
        if (!valid(price)) continue; // the API occasionally omits a price
        this.feeds.set(id, { price, conf: 0, publishTime: now });
        this.feedSource.set(id, "prestocks");
      }
    }
  }

  /** Where an asset's real-world reference price is coming from right now. */
  refSource(ticker: string): PriceSource {
    return this.feedSource.get(ASSETS.find((a) => a.ticker === ticker)!.feeds.ref) ?? "fallback";
  }

  private async pollMarketHours() {
    for (const a of XSTOCKS) {
      try {
        const res = await fetch(`${PUBLIC_HERMES}/v2/price_feeds?query=${a.ticker}&asset_type=equity`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) continue;
        const list = (await res.json()) as { id: string; market_hours?: { is_open: boolean; next_open: number | null; next_close: number | null } }[];
        const f = list.find((x) => x.id === a.feeds.ref);
        if (f?.market_hours) this.hours.set(a.ticker, { isOpen: f.market_hours.is_open, nextOpen: f.market_hours.next_open, nextClose: f.market_hours.next_close });
      } catch {
        /* keep the last known hours */
      }
    }
  }

  feed(id: string): FeedPrice | undefined {
    return this.feeds.get(id);
  }

  ref(ticker: string) {
    return this.feeds.get(ASSETS.find((a) => a.ticker === ticker)!.feeds.ref);
  }

  token(ticker: string) {
    return this.feeds.get(ASSETS.find((a) => a.ticker === ticker)!.feeds.token);
  }

  marketOpen(ticker: string): MarketHours | undefined {
    // Pre-IPO marks have no session; US equities share one schedule, so borrow any known entry.
    if (ASSETS.find((a) => a.ticker === ticker)?.kind === "prestock") return ALWAYS_OPEN;
    const h = this.hours.get(ticker) ?? this.hours.values().next().value;
    if (!h) return undefined;
    // Roll the cached schedule forward between refreshes.
    const now = Date.now() / 1000;
    if (h.isOpen && h.nextClose && now >= h.nextClose) return { ...h, isOpen: false };
    if (!h.isOpen && h.nextOpen && now >= h.nextOpen) return { ...h, isOpen: true };
    return h;
  }

  quote(ticker: string): AssetQuote {
    const a = ASSETS.find((x) => x.ticker === ticker)!;
    const ref = this.feeds.get(a.feeds.ref);
    const token = this.feeds.get(a.feeds.token);
    const rate = this.feeds.get(a.feeds.rate)?.price;
    const mint = this.tokens.get(ticker);
    const hours = this.marketOpen(ticker);
    const now = Date.now() / 1000;
    return {
      ticker,
      kind: a.kind,
      transferFeeBps: this.tokens.feeBps(ticker),
      ref,
      token,
      rate,
      multiplier: this.tokens.multiplier(ticker),
      pendingMultiplier: mint && mint.effectiveAt > now ? { value: mint.newMultiplier, effectiveAt: mint.effectiveAt } : undefined,
      paused: mint?.paused,
      marketOpen: hours?.isOpen,
      nextOpen: hours?.nextOpen,
      nextClose: hours?.nextClose,
      pegBps: ref && token ? (token.price / ref.price - 1) * 10_000 : undefined,
      sources: {
        ref: this.feedSource.get(a.feeds.ref) ?? "fallback",
        token: this.feedSource.get(a.feeds.token) ?? "fallback",
        rate: this.feedSource.get(a.feeds.rate) ?? "fallback",
      },
    };
  }

  snapshot(): MarketSnapshot {
    return { source: this.source, sourceNote: this.sourceNote, updatedAt: this.updatedAt, assets: ASSETS.map((a) => this.quote(a.ticker)) };
  }

  // ---- history -------------------------------------------------------------

  private sample() {
    const t = Math.floor(Date.now() / 1000);
    for (const a of ASSETS) {
      const ref = this.feeds.get(a.feeds.ref);
      const token = this.feeds.get(a.feeds.token);
      if (!ref || !token || !valid(ref.price) || !valid(token.price)) continue;
      const arr = this.history.get(a.ticker) ?? [];
      arr.push([t, ref.price, token.price]);
      while (arr.length && arr[0][0] < t - HISTORY_KEEP_S) arr.shift();
      this.history.set(a.ticker, arr);
    }
  }

  /** Pair ratio series (target price in source shares) from reference prices. */
  ratioSeries(from: string, to: string, sinceSec = 0): { t: number; r: number; rt: number }[] {
    const f = this.history.get(from) ?? [];
    const g = new Map((this.history.get(to) ?? []).map((s) => [s[0], s]));
    const out: { t: number; r: number; rt: number }[] = [];
    for (const s of f) {
      if (s[0] < sinceSec) continue;
      const o = g.get(s[0]);
      if (o) out.push({ t: s[0], r: o[1] / s[1], rt: o[2] / s[2] });
    }
    return out;
  }

  private loadHistory() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.historyFile, "utf8")) as Record<string, Sample[]>;
      for (const [k, v] of Object.entries(raw)) this.history.set(k, v.filter((x) => valid(x[1]) && valid(x[2])));
    } catch {
      /* no history yet */
    }
  }

  private saveHistory() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(this.historyFile, JSON.stringify(Object.fromEntries(this.history)));
    } catch (e) {
      console.warn("history save failed:", (e as Error).message);
    }
  }

  // Seed the chart with Pyth prices from recent US sessions (every 30 min, 13:30-20:00 UTC).
  private async backfill() {
    const have = this.history.get("SPY")?.length ?? 0;
    if (have > 200) return;
    const now = Math.floor(Date.now() / 1000);
    const times: number[] = [];
    for (let t = now - HISTORY_KEEP_S; t < now - 600; t += 1800) {
      const d = new Date(t * 1000);
      const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && mins >= 13 * 60 + 30 && mins <= 20 * 60) times.push(t - (t % 1800));
    }
    if (!XSTOCKS.some((a) => this.entitled.has(a.feeds.ref))) return;
    const ids = XSTOCKS.flatMap((a) => [a.feeds.ref, a.feeds.token]).filter((id) => this.entitled.has(id));
    const qs = ids.map((id) => `ids[]=${id}`).join("&");
    let added = 0;
    for (const t of times) {
      try {
        const res = await fetch(`${config.pythHermesUrl}/v2/updates/price/${t}?parsed=true&ignore_invalid_price_ids=true&${qs}`, {
          headers: this.pythHeaders(),
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { parsed: { id: string; price: { price: string; expo: number } }[] };
        const px = new Map(body.parsed.map((p) => [p.id.replace(/^0x/, ""), Number(p.price.price) * 10 ** p.price.expo]));
        for (const a of XSTOCKS) {
          const r = px.get(a.feeds.ref);
          const k = px.get(a.feeds.token);
          if (!r) continue;
          const arr = this.history.get(a.ticker) ?? [];
          arr.push([t, r, k ?? r]);
          this.history.set(a.ticker, arr);
        }
        added++;
      } catch {
        /* skip this point */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const arr of this.history.values()) arr.sort((x, y) => x[0] - y[0]);
    console.log(`backfilled ${added}/${times.length} Pyth history points`);
  }
}
