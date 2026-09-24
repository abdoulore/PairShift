import { PublicKey } from "@solana/web3.js";
import { getAsset, tokenSymbol } from "../shared/assets";
import { changePct, conditionMet, fmtNum, progress, shortfallBps, uiFromRaw } from "../shared/math";
import type { Check, ExecStyle, Intent, Limits, Mode, QuoteSummary } from "../shared/types";
import { config } from "./config";
import { getQuote, getSwapTransaction, routeLabel, type JupQuote } from "./jupiter";
import type { PriceService } from "./prices";
import { ata, buildSwitchTx, receivedRaw, sendAndConfirm, tokenAccountState } from "./solana";
import { store } from "./store";
import type { TokenState } from "./tokenState";

const QUOTE_REFRESH_MS = 30_000;
const DELEGATION_REFRESH_MS = 30_000;
const MAX_LIVE_ATTEMPTS = 3;

const age = (t: number) => Math.max(0, Math.round(Date.now() / 1000 - t));
const fmtAge = (s: number) => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
const fmtBps = (b: number) => `${b >= 0 ? "+" : ""}${b.toFixed(0)} bps`;

export class Engine {
  private quotes = new Map<string, { summary: QuoteSummary; raw: JupQuote }>();
  private delegation = new Map<string, { at: number; check: Check }>();
  private attempts = new Map<string, number>();
  private busy = false;

  constructor(
    private prices: PriceService,
    private tokens: TokenState,
  ) {}

  start() {
    const loop = () => this.tick().finally(() => setTimeout(loop, config.pollMs));
    loop();
  }

  // ---- safety checks --------------------------------------------------------

  /** Market-data checks shared by previews and live evaluation. */
  marketChecks(from: string, to: string, limits: Limits, mode: Mode): Check[] {
    const checks: Check[] = [];
    const legs = [
      { t: from, side: "sell" as const, kind: getAsset(from).kind, src: this.prices.refSource(from), ref: this.prices.ref(from), q: this.prices.quote(from) },
      { t: to, side: "buy" as const, kind: getAsset(to).kind, src: this.prices.refSource(to), ref: this.prices.ref(to), q: this.prices.quote(to) },
    ];
    const srcLabel = (l: (typeof legs)[number]) =>
      l.src === "pyth" ? "Pyth" : l.src === "prestocks" ? "PreStocks mark" : l.src === "jupiter" ? "Backed via Jupiter" : "loading";

    // Live switching only runs on authoritative references: Pyth for public equities, PreStocks marks for pre-IPO.
    const authoritative = legs.every((l) => l.src === "pyth" || l.src === "prestocks");
    checks.push({
      id: "source",
      label: "Trusted reference prices",
      ok: authoritative || mode === "paper",
      detail:
        legs.map((l) => `${l.t}: ${srcLabel(l)}`).join(" · ") +
        (authoritative ? "" : mode === "paper" ? " (paper only)" : " - live needs Pyth or PreStocks prices"),
    });

    const ages = legs.map((l) => (l.ref ? age(l.ref.publishTime) : Infinity));
    // Backed prices via Jupiter refresh every few minutes; tolerate that in paper mode only.
    // PreStocks marks move slowly and their API is polled every 20s, so allow up to 3 minutes.
    const maxAge = (l: (typeof legs)[number]) =>
      l.src === "jupiter" && mode === "paper"
        ? Math.max(limits.maxStalenessSec, 900)
        : l.src === "prestocks"
          ? Math.max(limits.maxStalenessSec, 180)
          : limits.maxStalenessSec;
    checks.push({
      id: "fresh",
      label: "Reference prices fresh",
      ok: legs.every((l, i) => ages[i] <= maxAge(l)),
      detail: legs.map((l, i) => `${l.t} ${Number.isFinite(ages[i]) ? fmtAge(ages[i]) : "n/a"}`).join(" · ") + ` (max ${fmtAge(Math.max(...legs.map(maxAge)))})`,
    });

    const equityLegs = legs.filter((l) => l.kind === "xstock");
    if (equityLegs.length) {
      const closed = equityLegs.filter((l) => l.q.marketOpen === false);
      const nextOpen = closed.map((l) => l.q.nextOpen).find((n) => n);
      checks.push({
        id: "market",
        label: "US market open",
        ok: closed.length === 0,
        detail: closed.length
          ? `Closed${nextOpen ? ` - reopens ${new Date(nextOpen * 1000).toUTCString().slice(0, 22)} UTC` : ""}`
          : "Real-world reference is trading",
      });
      const pythLegs = equityLegs.filter((l) => l.src === "pyth");
      const confs = pythLegs.map((l) => (l.ref && l.ref.price ? (l.ref.conf / l.ref.price) * 10_000 : Infinity));
      checks.push({
        id: "confidence",
        label: "Pyth confidence tight",
        ok: confs.every((c) => c <= limits.maxConfBps),
        detail: pythLegs.length ? pythLegs.map((l, i) => `${l.t} ±${Number.isFinite(confs[i]) ? confs[i].toFixed(1) : "?"} bps`).join(" · ") : "No Pyth-priced leg",
      });
    }

    // One-sided: never sell a token below its reference or buy one above it by more than the limit.
    const pegLine = (l: (typeof legs)[number], limit: number) => {
      const p = l.q.pegBps;
      if (p === undefined) return { ok: false, text: `${l.t} n/a` };
      const bad = l.side === "buy" ? p > limit : p < -limit;
      return { ok: !bad, text: `${l.side} ${l.t} at ${fmtBps(p)}` };
    };
    const pub = equityLegs.map((l) => pegLine(l, limits.maxPegDeviationBps));
    if (pub.length)
      checks.push({
        id: "peg",
        label: "xStocks track their stock",
        ok: pub.every((p) => p.ok),
        detail: pub.map((p) => p.text).join(" · ") + ` vs Pyth (limit ${limits.maxPegDeviationBps})`,
      });
    const priv = legs.filter((l) => l.kind === "prestock").map((l) => pegLine(l, limits.maxPrivatePremiumBps));
    if (priv.length)
      checks.push({
        id: "private",
        label: "Pre-IPO price vs PreStocks mark",
        ok: priv.every((p) => p.ok),
        detail: priv.map((p) => p.text).join(" · ") + ` (limit ${limits.maxPrivatePremiumBps})`,
      });

    const corp = legs.map((l) => ({ t: l.t, ...this.tokens.corporateActionNear(l.t, limits.corporateActionWindowHours) }));
    const rrMismatch = legs
      .filter((l) => l.kind === "xstock" && l.q.sources?.rate === "pyth" && l.q.rate && l.q.multiplier && Math.abs(l.q.rate / l.q.multiplier - 1) > 0.001)
      .map((l) => l.t);
    const nearCorp = corp.filter((c) => c.near);
    checks.push({
      id: "corporate",
      label: "No corporate action in flight",
      ok: nearCorp.length === 0 && rrMismatch.length === 0,
      detail: nearCorp.length
        ? `${nearCorp.map((c) => c.t).join(", ")} multiplier changes ${new Date(nearCorp[0].at! * 1000).toUTCString().slice(0, 22)}`
        : rrMismatch.length
          ? `Pyth redemption rate ≠ on-chain multiplier for ${rrMismatch.join(", ")}`
          : "Multipliers stable",
    });

    const paused = legs.filter((l) => l.q.paused).map((l) => l.t);
    checks.push({ id: "paused", label: "Tokens not paused", ok: paused.length === 0, detail: paused.length ? `${paused.join(", ")} paused by issuer` : "Transfers enabled" });
    return checks;
  }

  /**
   * Quote the switch and measure execution quality against token market prices, after the known
   * Token-2022 transfer fees (PreStocks: 1% per transfer). Valuation vs. the real-world reference is
   * handled separately by the peg / pre-IPO checks.
   */
  async quoteSwitch(from: string, to: string, amountRaw: bigint, style: ExecStyle, slippageBps = 50, fresh = false) {
    const src = getAsset(from);
    const dst = getAsset(to);
    const pull = style === "auto"; // auto switches: the keeper pulls from the owner first
    const pullFee = pull ? this.tokens.feeFor(from, amountRaw) : 0n;
    const netIn = amountRaw - pullFee;
    // Jupiter quotes include the target token's transfer fee but not the source token's fee on the
    // way into the pool (measured: exactly 1% short for PreStocks inputs). Account for it ourselves,
    // and widen the on-chain minimum-out by that known fee so only real slippage counts against it.
    const srcFeeBps = this.tokens.feeBps(from);
    const raw = await getQuote(src.mint, dst.mint, netIn, slippageBps + srcFeeBps, fresh);
    const fromTok = this.prices.token(from)?.price;
    const toTok = this.prices.token(to)?.price;
    if (!fromTok || !toTok) throw new Error("Missing token prices");
    const inUi = uiFromRaw(amountRaw, src.decimals, this.tokens.multiplier(from));
    const outUi = uiFromRaw(raw.outAmount, dst.decimals, this.tokens.multiplier(to)) * (1 - srcFeeBps / 10_000);
    const fairOutUi = (inUi * fromTok) / toTok;
    // [keeper pull (source fee)] + into the pool (source fee) + out to the owner (target fee)
    const fs = this.tokens.feeBps(from) / 10_000;
    const ft = this.tokens.feeBps(to) / 10_000;
    const feeFactor = (pull ? 1 - fs : 1) * (1 - fs) * (1 - ft);
    const summary: QuoteSummary = {
      at: Date.now(),
      inUi,
      outUi,
      fairOutUi,
      shortfallBps: shortfallBps(outUi, fairOutUi * feeFactor),
      feeBps: (1 - feeFactor) * 10_000,
      priceImpactPct: Number(raw.priceImpactPct) * 100,
      route: routeLabel(raw),
    };
    return { summary, raw, netIn };
  }

  quoteCheck(q: QuoteSummary | undefined, limits: Limits, err?: string): Check {
    if (err) return { id: "quote", label: "Execution within slippage", ok: false, detail: err };
    if (!q) return { id: "quote", label: "Execution within slippage", ok: true, pending: true, detail: "Quoted when the trigger is near" };
    return {
      id: "quote",
      label: "Execution within slippage",
      ok: q.shortfallBps <= limits.maxSlippageBps,
      detail:
        `${fmtBps(-q.shortfallBps)} vs market via ${q.route} (max -${limits.maxSlippageBps})` +
        (q.feeBps > 0 ? `, plus ${(q.feeBps / 100).toFixed(1)}% token transfer fees` : ""),
    };
  }

  async delegationCheck(intent: Intent, force = false): Promise<Check> {
    const cached = this.delegation.get(intent.id);
    if (cached && !force && Date.now() - cached.at < DELEGATION_REFRESH_MS) return cached.check;
    let check: Check;
    try {
      const st = await tokenAccountState(new PublicKey(intent.owner), intent.from);
      const keeper = config.keeper?.publicKey.toBase58();
      const need = BigInt(intent.amountRaw);
      if (st.amount < need) check = { id: "delegation", label: "Funds approved", ok: false, detail: `Wallet holds less ${tokenSymbol(intent.from)} than this switch needs` };
      else if (st.delegate !== keeper || st.delegatedAmount < need)
        check = { id: "delegation", label: "Funds approved", ok: false, detail: "Approval missing or revoked" };
      else check = { id: "delegation", label: "Funds approved", ok: true, detail: `${intent.amountUi.toFixed(4)} ${tokenSymbol(intent.from)} approved, still in your wallet` };
    } catch (e) {
      check = cached?.check ?? { id: "delegation", label: "Funds approved", ok: false, detail: `RPC error: ${(e as Error).message}` };
    }
    this.delegation.set(intent.id, { at: Date.now(), check });
    return check;
  }

  async balanceCheck(intent: Intent, force = false): Promise<Check> {
    const cached = this.delegation.get(intent.id);
    if (cached && !force && Date.now() - cached.at < DELEGATION_REFRESH_MS) return cached.check;
    let check: Check;
    try {
      const st = await tokenAccountState(new PublicKey(intent.owner), intent.from);
      check =
        st.amount >= BigInt(intent.amountRaw)
          ? { id: "balance", label: `Wallet holds ${intent.from}`, ok: true, detail: `${intent.amountUi.toFixed(4)} ${intent.from} ready; you confirm when it triggers` }
          : { id: "balance", label: `Wallet holds ${intent.from}`, ok: false, detail: `Wallet holds less ${intent.from} than this switch needs` };
    } catch (e) {
      check = cached?.check ?? { id: "balance", label: `Wallet holds ${intent.from}`, ok: false, detail: `RPC error: ${(e as Error).message}` };
    }
    this.delegation.set(intent.id, { at: Date.now(), check });
    return check;
  }

  // ---- evaluation loop -------------------------------------------------------

  private async tick() {
    const armed = store.all().filter((i) => i.status === "armed" || i.status === "ready");
    await Promise.all(armed.map((i) => this.evaluate(i).catch((e) => store.event(i, "error", `Evaluation error: ${(e as Error).message}`))));
  }

  private async evaluate(intent: Intent) {
    if (Date.now() > intent.expiresAt) {
      intent.status = "expired";
      store.event(intent, "warn", "Expired before the condition was met");
      store.touch();
      return;
    }
    const fromFeed = this.prices.ref(intent.from);
    const toFeed = this.prices.ref(intent.to);
    if (!fromFeed || !toFeed) return;
    const fromRef = fromFeed.price;
    const toRef = toFeed.price;

    const ratio = toRef / fromRef;
    const met = conditionMet(ratio, intent.triggerRatio, intent.direction);
    // A confirmation only counts when each leg has a new reference price. One stale or bad tick
    // (PreStocks marks update every ~20s; the engine runs every 2s) can't confirm itself.
    const refTimes: [number, number] = [fromFeed.publishTime, toFeed.publishTime];
    const prev = intent.lastEval;
    const legStreaks: [number, number] = met
      ? ([0, 1].map((i) =>
          !prev?.conditionMet || !prev.legStreaks || !prev.refTimes
            ? 1
            : prev.legStreaks[i] + (refTimes[i] !== prev.refTimes[i] ? 1 : 0),
        ) as [number, number])
      : [0, 0];
    const streak = Math.min(...legStreaks);
    const checks = this.marketChecks(intent.from, intent.to, intent.limits, intent.mode);

    // Quote only when it matters (condition met) or periodically for the dashboard.
    let q = this.quotes.get(intent.id);
    let quoteErr: string | undefined;
    if (met || !q || Date.now() - q.summary.at > QUOTE_REFRESH_MS) {
      try {
        q = await this.quoteSwitch(intent.from, intent.to, BigInt(intent.amountRaw), intent.style);
        this.quotes.set(intent.id, q);
      } catch (e) {
        quoteErr = (e as Error).message;
      }
    }
    checks.push(this.quoteCheck(q?.summary, intent.limits, quoteErr));
    if (intent.mode === "live") checks.push(intent.style === "auto" ? await this.delegationCheck(intent, met) : await this.balanceCheck(intent, met));

    const failing = checks.find((c) => !c.ok);
    intent.lastEval = {
      at: Date.now(),
      ratio,
      changePct: changePct(ratio, intent.baseline.ratio),
      progress: progress(ratio, intent.baseline.ratio, intent.direction, intent.thresholdPct),
      conditionMet: met,
      streak,
      legStreaks,
      refTimes,
      checks,
      blockedBy: met ? failing?.label : undefined,
      quote: q?.summary,
    };
    store.touch();

    if (intent.status === "ready") {
      if (!met || failing) {
        intent.status = "armed";
        store.event(intent, "warn", `No longer ready (${!met ? "condition reversed" : failing!.label}); back to monitoring`);
      }
      return;
    }
    if (met && failing) store.event(intent, "warn", `Condition met, waiting on: ${failing.label}`);
    if (met && !failing && streak < intent.limits.confirmations)
      store.event(intent, "info", `Condition met (${streak}/${intent.limits.confirmations} fresh price updates)`);
    if (met && !failing && streak >= intent.limits.confirmations) await this.execute(intent, q!);
  }

  // ---- execution -------------------------------------------------------------

  private async execute(intent: Intent, q: { summary: QuoteSummary; raw: JupQuote }) {
    const ratio = intent.lastEval!.ratio;
    if (intent.mode === "paper") {
      intent.status = "executed";
      intent.execution = { at: Date.now(), paper: true, ratio, ...pick(q.summary) };
      store.event(intent, "success", `Paper switch: ${fmtNum(q.summary.inUi)} ${intent.from} -> ${fmtNum(q.summary.outUi)} ${intent.to} at ratio ${ratio.toFixed(5)}`);
      store.touch();
      return;
    }

    if (intent.style === "confirm") {
      intent.status = "ready";
      intent.readyAt = Date.now();
      store.event(intent, "success", "Ready: all checks pass. Confirm in your wallet to switch.");
      store.touch();
      return;
    }

    if (!config.keeper || !config.liveExecution) {
      store.event(intent, "warn", "Live execution is disabled on this server");
      return;
    }
    if (this.busy) return; // one keeper transaction at a time
    this.busy = true;
    intent.status = "executing";
    store.event(intent, "info", "Trigger confirmed - executing atomic switch");
    store.touch();
    try {
      const delegation = await this.delegationCheck(intent, true);
      if (!delegation.ok) throw new Error(delegation.detail);
      // Leave only the slippage budget the fair-value limit still allows, so the on-chain
      // minimum-out enforces the user's limit even if the market moves mid-flight.
      const budget = Math.max(10, Math.min(100, Math.floor(intent.limits.maxSlippageBps - Math.max(0, q.summary.shortfallBps))));
      const fresh = await this.quoteSwitch(intent.from, intent.to, BigInt(intent.amountRaw), "auto", budget, true);
      if (fresh.summary.shortfallBps > intent.limits.maxSlippageBps) throw new Error(`Quote moved: ${fresh.summary.shortfallBps.toFixed(0)} bps below fair value`);

      const owner = new PublicKey(intent.owner);
      const { tx, blockhash, lastValidBlockHeight, ownerDst } = await buildSwitchTx(config.keeper, owner, intent.from, intent.to, BigInt(intent.amountRaw), fresh.raw);
      const sig = await sendAndConfirm(tx, blockhash, lastValidBlockHeight);
      const got = await receivedRaw(sig, ownerDst);
      const outUi = got !== undefined ? uiFromRaw(got, getAsset(intent.to).decimals, this.tokens.multiplier(intent.to)) : fresh.summary.outUi;
      intent.status = "executed";
      intent.execution = { at: Date.now(), paper: false, signature: sig, ratio, ...pick(fresh.summary), outUi, shortfallBps: netShortfall(outUi, fresh.summary) };
      store.event(intent, "success", `Switched ${fmtNum(fresh.summary.inUi)} ${tokenSymbol(intent.from)} -> ${fmtNum(outUi)} ${tokenSymbol(intent.to)}`);
    } catch (e) {
      const n = (this.attempts.get(intent.id) ?? 0) + 1;
      this.attempts.set(intent.id, n);
      const msg = (e as Error).message.slice(0, 300);
      if (n >= MAX_LIVE_ATTEMPTS) {
        intent.status = "failed";
        intent.execution = { at: Date.now(), paper: false, ratio, ...pick(q.summary), error: msg };
        store.event(intent, "error", `Switch failed after ${n} attempts: ${msg}`);
      } else {
        intent.status = "armed";
        intent.lastEval = { ...intent.lastEval!, streak: 0, legStreaks: [0, 0], conditionMet: false };
        store.event(intent, "warn", `Attempt ${n} failed, re-arming: ${msg}`);
      }
    } finally {
      this.busy = false;
      store.touch();
    }
  }

  /** One-tap confirm: re-run every check, then hand back a swap transaction for the owner to sign. */
  async buildConfirmTx(intent: Intent): Promise<{ tx: string; quote: QuoteSummary }> {
    if (intent.status !== "ready") throw new Error("This switch is not ready");
    const fromRef = this.prices.ref(intent.from)?.price;
    const toRef = this.prices.ref(intent.to)?.price;
    if (!fromRef || !toRef || !conditionMet(toRef / fromRef, intent.triggerRatio, intent.direction)) throw new Error("The trigger condition no longer holds");
    const checks = this.marketChecks(intent.from, intent.to, intent.limits, intent.mode);
    checks.push(await this.balanceCheck(intent, true));
    const first = await this.quoteSwitch(intent.from, intent.to, BigInt(intent.amountRaw), "confirm", 50, true);
    checks.push(this.quoteCheck(first.summary, intent.limits));
    const failing = checks.find((c) => !c.ok);
    if (failing) throw new Error(`${failing.label}: ${failing.detail}`);
    const budget = Math.max(10, Math.min(100, Math.floor(intent.limits.maxSlippageBps - Math.max(0, first.summary.shortfallBps))));
    const fresh = await this.quoteSwitch(intent.from, intent.to, BigInt(intent.amountRaw), "confirm", budget, true);
    const tx = await getSwapTransaction(fresh.raw, intent.owner);
    this.quotes.set(intent.id, fresh);
    return { tx, quote: fresh.summary };
  }

  async recordConfirmed(intent: Intent, signature: string) {
    const q = this.quotes.get(intent.id)?.summary;
    const dst = getAsset(intent.to);
    const got = await receivedRaw(signature, ata(new PublicKey(intent.owner), dst.mint));
    const outUi = got !== undefined ? uiFromRaw(got, dst.decimals, this.tokens.multiplier(intent.to)) : (q?.outUi ?? 0);
    intent.status = "executed";
    intent.execution = {
      at: Date.now(),
      paper: false,
      signature,
      ratio: intent.lastEval?.ratio ?? intent.triggerRatio,
      inUi: q?.inUi ?? intent.amountUi,
      outUi,
      fairOutUi: q?.fairOutUi ?? outUi,
      shortfallBps: q ? netShortfall(outUi, q) : 0,
      route: q?.route ?? "Jupiter",
    };
    store.event(intent, "success", `Confirmed: ${fmtNum(intent.execution.inUi)} ${intent.from} -> ${fmtNum(outUi)} ${intent.to}`);
    store.touch();
  }
}

const netShortfall = (outUi: number, s: QuoteSummary) => shortfallBps(outUi, s.fairOutUi * (1 - s.feeBps / 10_000));

const pick = (s: QuoteSummary) => ({ inUi: s.inUi, outUi: s.outUi, fairOutUi: s.fairOutUi, shortfallBps: s.shortfallBps, route: s.route });
