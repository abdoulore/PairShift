import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { ShieldCheck, Wallet } from "@phosphor-icons/react";
import { ASSETS, ASSET_BY_TICKER, tokenSymbol } from "../../shared/assets";
import { fmtUsd } from "../../shared/math";
import { intentMessage } from "../../shared/messages";
import { DEFAULT_LIMITS, PRE_IPO_SLIPPAGE_BPS, canonicalDraft, type IntentDraft, type Mode } from "../../shared/types";
import { api, type Preview } from "../api";
import { ChecksList } from "../components/Checks";
import { PairChart } from "../components/PairChart";
import { useDebounced, usePoll } from "../lib/hooks";
import { b64, useAppData } from "../state/AppData";

const EXAMPLES = [
  "Move $300 from Tesla into SpaceX when SpaceX gets 5% cheaper relative to Tesla",
  "Move $500 from SPY into NVDA when NVIDIA becomes 6% cheaper relative to the S&P 500",
  "Switch $200 of OpenAI into Anthropic if Anthropic underperforms OpenAI by 8%",
  "Rotate $1,000 from QQQ into TSLA once Tesla outperforms the Nasdaq by 5%",
];

const GROUPS = [
  { label: "Public stocks (xStocks)", kind: "xstock" },
  { label: "Pre-IPO (PreStocks)", kind: "prestock" },
] as const;

function AssetOptions() {
  return (
    <>
      {GROUPS.map((g) => (
        <optgroup key={g.kind} label={g.label}>
          {ASSETS.filter((a) => a.kind === g.kind).map((a) => (
            <option key={a.ticker} value={a.ticker}>
              {a.ticker}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

const INITIAL: IntentDraft = {
  from: "TSLA",
  to: "SPACEX",
  sizing: { kind: "usd", usd: 300 },
  direction: "cheaper",
  thresholdPct: 5,
  mode: "paper",
  limits: DEFAULT_LIMITS,
  expiresInDays: 7,
};

const SOURCE_NAMES = { pyth: "Pyth", prestocks: "PreStocks marks", jupiter: "Backed via Jupiter" } as const;

/** Sentence used when arriving from Markets or the landing page with ?to= (and optionally ?from=). */
function prefillText(params: URLSearchParams): string | undefined {
  const to = params.get("to")?.toUpperCase();
  if (!to || !ASSET_BY_TICKER[to]) return undefined;
  let from = params.get("from")?.toUpperCase();
  if (!from || !ASSET_BY_TICKER[from] || from === to) from = to === "TSLA" ? "QQQ" : "TSLA";
  return `Move $300 from ${from} into ${to} when ${to} gets 5% cheaper relative to ${from}`;
}

export function NewSwitch() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { owner, status, market, say } = useAppData();

  const [text, setText] = useState(() => prefillText(params) ?? EXAMPLES[0]);
  const [draft, setDraft] = useState<IntentDraft>(INITIAL);
  const [notes, setNotes] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [series, setSeries] = useState<{ t: number; r: number }[]>([]);
  const [arming, setArming] = useState(false);

  useEffect(() => {
    const t = prefillText(params);
    if (t) setText(t);
  }, [params]);

  // Plain English -> structured draft
  const debouncedText = useDebounced(text, 350);
  useEffect(() => {
    if (!debouncedText.trim()) return;
    api
      .parse(debouncedText)
      .then((r) => {
        setNotes([...r.notes, ...(r.missing.length ? [`Could not find: ${r.missing.join(", ")}. Fill it in below.`] : [])]);
        setDraft((d) => ({
          ...d,
          ...(r.draft.from ? { from: r.draft.from } : {}),
          ...(r.draft.to ? { to: r.draft.to } : {}),
          ...(r.draft.sizing ? { sizing: r.draft.sizing } : {}),
          ...(r.draft.direction ? { direction: r.draft.direction } : {}),
          ...(r.draft.thresholdPct !== undefined ? { thresholdPct: r.draft.thresholdPct } : {}),
          ...(r.draft.expiresInDays ? { expiresInDays: r.draft.expiresInDays } : {}),
          ...(r.draft.mode ? { mode: r.draft.mode } : {}),
          text: debouncedText,
        }));
      })
      .catch(() => {});
  }, [debouncedText]);

  // Live preview: baseline, trigger, checks, executable quote
  const debouncedDraft = useDebounced(draft, 300);
  const refreshPreview = useCallback(() => {
    api
      .preview(debouncedDraft, owner)
      .then((p) => {
        setPreview(p);
        setPreviewErr(null);
      })
      .catch((e) => setPreviewErr(e.message));
  }, [debouncedDraft, owner]);
  usePoll(refreshPreview, 10_000, [refreshPreview]);
  usePoll(() => api.pair(draft.from, draft.to).then((r) => setSeries(r.series)).catch(() => {}), 30_000, [draft.from, draft.to]);

  const style = preview?.style ?? (ASSET_BY_TICKER[draft.from]?.kind === "prestock" ? "confirm" : "auto");
  const liveReady = Boolean(
    status?.liveEnabled && (style === "confirm" || status.autoEnabled) && wallet.connected && wallet.signMessage && wallet.signTransaction,
  );
  const mode: Mode = draft.mode === "live" && liveReady ? "live" : draft.mode;
  const set = (patch: Partial<IntentDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Pre-IPO pools are thinner: use the wider slippage default for them unless the user set their own.
  const slippageTouched = useRef(false);
  const preIpo = ASSET_BY_TICKER[draft.from]?.kind === "prestock" || ASSET_BY_TICKER[draft.to]?.kind === "prestock";
  useEffect(() => {
    if (slippageTouched.current) return;
    const want = preIpo ? PRE_IPO_SLIPPAGE_BPS : DEFAULT_LIMITS.maxSlippageBps;
    setDraft((d) => (d.limits.maxSlippageBps === want ? d : { ...d, limits: { ...d.limits, maxSlippageBps: want } }));
  }, [preIpo]);
  const allPass = preview?.checks.every((c) => c.ok) ?? false;
  const sameAsset = draft.from === draft.to;

  async function arm() {
    setArming(true);
    try {
      const full: IntentDraft = { ...draft, mode, limits: { ...DEFAULT_LIMITS, ...draft.limits } };
      if (mode === "paper") {
        await api.create({ draft: full, owner });
        say("Paper switch armed. Track it in My switches.");
        navigate("/app/switches");
        return;
      }
      const pk = wallet.publicKey!.toBase58();
      const ts = Date.now();
      const sig = await wallet.signMessage!(new TextEncoder().encode(intentMessage(pk, canonicalDraft(full), ts)));
      const { intent, approvalTx } = await api.create({ draft: full, owner: pk, ts, signature: bs58.encode(sig) });
      if (!approvalTx) {
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
        say("Armed. When it triggers and every check passes, you'll confirm in one tap.");
        navigate("/app/switches");
        return;
      }
      say("Approve the exact amount in your wallet. Your stock stays with you until the switch.");
      const signed = await wallet.signTransaction!(VersionedTransaction.deserialize(Buffer.from(approvalTx, "base64")));
      await api.confirm(intent.id, b64(signed));
      say("Live switch armed. Approval confirmed on-chain.");
      navigate("/app/switches");
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setArming(false);
    }
  }

  const digits = preview && preview.ratio < 1 ? 5 : 4;
  // Name the reference sources actually behind this pair.
  const srcOf = (t: string) => market?.assets.find((a) => a.ticker === t)?.sources?.ref;
  const pairSources = new Set([srcOf(draft.from), srcOf(draft.to)]);
  const refLabel =
    (["pyth", "prestocks", "jupiter"] as const)
      .filter((k) => pairSources.has(k))
      .map((k) => SOURCE_NAMES[k])
      .join(" + ") || "loading prices";
  const quote = preview?.quote;
  const outNow = quote ? quote.outUi : preview?.outNow;
  const outAtTrigger = preview && outNow !== undefined ? outNow * (preview.ratio / preview.trigger) : undefined;
  const chg = outNow && outAtTrigger ? ((outAtTrigger / outNow - 1) * 100).toFixed(1) : "";

  return (
    <main className="page">
      <div className="page-head">
        <h1>New switch</h1>
        <p>Describe it, check the plan and the safety checks, then arm it. Paper mode needs no wallet.</p>
      </div>

      <div className="grid">
        <div className="stack">
          <section className="card composer">
            <div className="card-pad">
              <label className="field-label" htmlFor="intent">
                Your switch, in plain English
              </label>
              <textarea id="intent" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              <div className="examples">
                {EXAMPLES.filter((ex) => ex !== text).slice(0, 3).map((ex) => (
                  <button key={ex} className="example" onClick={() => setText(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
              {notes.length > 0 && <p className="parse-notes">{notes.join(" ")}</p>}

              <div className="sentence">
                Move{" "}
                <span className="seg" role="group" aria-label="Amount unit">
                  <button className={draft.sizing.kind === "usd" ? "on" : ""} onClick={() => set({ sizing: { kind: "usd", usd: draft.sizing.kind === "usd" ? draft.sizing.usd : 500 } })}>
                    $
                  </button>
                  <button className={draft.sizing.kind === "shares" ? "on" : ""} onClick={() => set({ sizing: { kind: "shares", shares: draft.sizing.kind === "shares" ? draft.sizing.shares : 1 } })}>
                    shares
                  </button>
                </span>{" "}
                <input
                  className="inline"
                  type="number"
                  min={0}
                  step="any"
                  aria-label="Amount"
                  value={draft.sizing.kind === "usd" ? draft.sizing.usd : draft.sizing.shares}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    set({ sizing: draft.sizing.kind === "usd" ? { kind: "usd", usd: n } : { kind: "shares", shares: n } });
                  }}
                />{" "}
                of{" "}
                <select className="inline" aria-label="Move out of" value={draft.from} onChange={(e) => set({ from: e.target.value })}>
                  <AssetOptions />
                </select>{" "}
                into{" "}
                <select className="inline" aria-label="Move into" value={draft.to} onChange={(e) => set({ to: e.target.value })}>
                  <AssetOptions />
                </select>{" "}
                when <strong>{draft.to}</strong> {draft.direction === "cheaper" ? "becomes" : "outperforms"}{" "}
                {draft.direction === "richer" && (
                  <>
                    <strong>{draft.from}</strong> by{" "}
                  </>
                )}
                <input
                  className="inline pct"
                  type="number"
                  min={0}
                  max={50}
                  step="0.1"
                  aria-label="Threshold percent"
                  value={draft.thresholdPct}
                  onChange={(e) => set({ thresholdPct: Number(e.target.value) })}
                />
                %{" "}
                <span className="seg" role="group" aria-label="Direction">
                  <button className={draft.direction === "cheaper" ? "on" : ""} onClick={() => set({ direction: "cheaper" })}>
                    cheaper
                  </button>
                  <button className={draft.direction === "richer" ? "on" : ""} onClick={() => set({ direction: "richer" })}>
                    stronger
                  </button>
                </span>
                {draft.direction === "cheaper" && (
                  <>
                    {" "}
                    relative to <strong>{draft.from}</strong>
                  </>
                )}
                .
              </div>
              {sameAsset && <p className="hint bad">Pick two different stocks.</p>}
              {previewErr && !sameAsset && <p className="hint bad">{previewErr}</p>}
              {preview?.thinTrigger !== undefined && (
                <p className="hint warn" style={{ marginTop: 8 }}>
                  Fees and spread on this route are about {preview.thinTrigger.toFixed(1)}%, which would eat most of a {preview.draft.thresholdPct}% move. Consider a
                  trigger of {Math.ceil(preview.thinTrigger * 3)}% or more.
                </p>
              )}
            </div>

            <div className="plan">
              <div>
                <div className="k">Today</div>
                <div className="v">{preview ? `1 ${preview.draft.to} = ${preview.ratio.toFixed(digits)}` : <span className="skeleton" style={{ display: "block", height: 24 }} />}</div>
                <div className="s">{preview ? `${preview.draft.from} shares, priced by ${refLabel}` : " "}</div>
              </div>
              <div>
                <div className="k">Switches at</div>
                <div className="v">{preview ? preview.trigger.toFixed(digits) : <span className="skeleton" style={{ display: "block", height: 24 }} />}</div>
                <div className="s">
                  {preview
                    ? preview.draft.direction === "cheaper"
                      ? `${preview.draft.from} per ${preview.draft.to} or less`
                      : `${preview.draft.from} per ${preview.draft.to} or more`
                    : " "}
                </div>
              </div>
              <div>
                <div className="k">You would receive</div>
                <div className="v">
                  {preview && outAtTrigger !== undefined ? `${outAtTrigger.toFixed(4)} ${preview.draft.to}` : <span className="skeleton" style={{ display: "block", height: 24 }} />}
                </div>
                <div className="s">
                  {preview && outNow !== undefined
                    ? `for ${preview.amountUi.toFixed(4)} ${preview.draft.from} (${fmtUsd(preview.usdValue, 0)}), vs ${outNow.toFixed(4)} today (${Number(chg) >= 0 ? "+" : ""}${chg}%)${quote ? ", after fees" : ""}`
                    : " "}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>
                {draft.to} priced in {draft.from} shares
              </h2>
              <span className="sub">Priced by {refLabel}. Shaded area is where the switch fires.</span>
            </div>
            <PairChart series={series} from={draft.from} to={draft.to} baseline={preview?.ratio} trigger={preview?.trigger} direction={draft.direction} />
          </section>
        </div>

        <aside className="card">
          <div className="card-head">
            <h2>Safety checks</h2>
            <span className="sub">{preview ? (allPass ? "All passing now" : "Some blocking now") : "Loading"}</span>
          </div>
          <ChecksList checks={preview?.checks} loading={!preview} />
          {quote && (
            <p className="hint" style={{ padding: "0 20px 12px" }}>
              Right now {quote.inUi.toFixed(4)} {tokenSymbol(draft.from)} would swap for {quote.outUi.toFixed(4)} {tokenSymbol(draft.to)} after fees, vs{" "}
              {quote.fairOutUi.toFixed(4)} at market prices before fees.
            </p>
          )}
          <div className="side-actions">
            <div className="mode" role="group" aria-label="Execution mode">
              <button className={mode === "paper" ? "on" : ""} onClick={() => set({ mode: "paper" })}>
                Paper
              </button>
              <button className={mode === "live" ? "on" : ""} onClick={() => set({ mode: "live" })} disabled={!status?.liveEnabled}>
                Live
              </button>
            </div>
            {mode === "paper" ? (
              <p className="hint">Paper mode runs the same checks and quotes, without moving funds.</p>
            ) : style === "confirm" ? (
              <p className="hint">
                {draft.from} charges a 1% transfer fee, so PairShift won't move it an extra time. When the trigger fires and every check passes, you confirm the swap in
                one tap.
              </p>
            ) : (
              <p className="hint">You sign one approval for the exact amount. Your {tokenSymbol(draft.from)} stays in your wallet until the switch fires.</p>
            )}
            {draft.mode === "live" && !liveReady && (
              <p className="hint warn">
                {!status?.liveEnabled
                  ? "Live switching is disabled on this server."
                  : style === "auto" && !status.autoEnabled
                    ? `Automatic switching unavailable: ${status.liveBlockers.join(", ")}.`
                    : "Connect a wallet that can sign messages and transactions."}
              </p>
            )}

            <details className="advanced">
              <summary>Limits and expiry</summary>
              <div className="limits">
                {(
                  [
                    ["maxSlippageBps", "Max slippage after fees (bps)"],
                    ["maxPegDeviationBps", "xStock premium limit (bps)"],
                    ["maxPrivatePremiumBps", "Pre-IPO premium limit (bps)"],
                    ["maxStalenessSec", "Max price age (s)"],
                    ["maxConfBps", "Max Pyth confidence (bps)"],
                    ["confirmations", "Confirmations"],
                    ["corporateActionWindowHours", "Corporate action window (h)"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      type="number"
                      min={0}
                      value={draft.limits[k]}
                      onChange={(e) => {
                        if (k === "maxSlippageBps") slippageTouched.current = true;
                        set({ limits: { ...draft.limits, [k]: Number(e.target.value) } });
                      }}
                    />
                  </label>
                ))}
                <label>
                  Expires after (days)
                  <input type="number" min={1} max={90} value={draft.expiresInDays} onChange={(e) => set({ expiresInDays: Number(e.target.value) })} />
                </label>
              </div>
            </details>

            <button className="btn btn-primary" onClick={arm} disabled={!preview || sameAsset || arming || (draft.mode === "live" && !liveReady)}>
              {mode === "live" ? <Wallet size={18} weight="bold" /> : <ShieldCheck size={18} weight="bold" />}
              {arming ? "Arming" : mode === "live" ? (style === "confirm" ? "Sign and arm" : "Approve and arm") : "Arm paper switch"}
            </button>
            {preview && !allPass && <p className="hint">Checks are re-run continuously. Blocked checks only delay the switch; they never loosen your limits.</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
