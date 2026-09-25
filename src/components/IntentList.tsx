import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowSquareOut, CaretDown, CaretUp } from "@phosphor-icons/react";
import { tokenSymbol } from "../../shared/assets";
import { describeCondition, describeSizing, fmtNum } from "../../shared/math";
import type { Intent } from "../../shared/types";
import { Receipt } from "./Receipt";

function statusBadge(i: Intent): { cls: string; text: string } {
  const e = i.lastEval;
  switch (i.status) {
    case "awaiting_approval":
      return { cls: "warn", text: "Awaiting wallet approval" };
    case "executing":
      return { cls: "accent", text: "Executing switch" };
    case "ready":
      return { cls: "good", text: "Ready: confirm to switch" };
    case "executed":
      return { cls: "good", text: i.execution?.paper ? "Switched (paper)" : "Switched" };
    case "failed":
      return { cls: "bad", text: "Failed" };
    case "cancelled":
      return { cls: "", text: "Cancelled" };
    case "expired":
      return { cls: "", text: "Expired" };
    default:
      if (e?.conditionMet && e.blockedBy) return { cls: "warn", text: `Waiting on: ${e.blockedBy}` };
      if (e?.conditionMet) return { cls: "accent", text: `Confirming ${e.streak}/${i.limits.confirmations}` };
      return { cls: "accent", text: "Monitoring" };
  }
}

const fmtMove = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface Props {
  intents: Intent[];
  onCancel: (i: Intent) => void;
  onConfirm: (i: Intent) => void;
  busyId?: string;
  empty?: ReactNode;
}

export function IntentList({ intents, onCancel, onConfirm, busyId, empty }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  if (!intents.length) {
    return (
      <div className="card empty">{empty ?? "No switches yet. Start one from New switch; paper mode needs no wallet."}</div>
    );
  }
  return (
    <div className="intents">
      {intents.map((i) => {
        const b = statusBadge(i);
        const e = i.lastEval;
        const need = i.direction === "cheaper" ? -i.thresholdPct : i.thresholdPct;
        const active = i.status === "armed" || i.status === "ready" || i.status === "awaiting_approval";
        return (
          <div className="card intent" key={i.id}>
            <div>
              <div className="pair">
                {i.from} <ArrowRight size={14} weight="bold" /> {i.to}
                <span className={`badge ${i.mode}`}>{i.mode === "live" ? "Live" : "Paper"}</span>
                {i.style === "confirm" && <span className="badge" title="Switching out of a pre-IPO token: you confirm in one tap, so it is not transferred an extra time">One tap</span>}
              </div>
              <div className="cond">
                Move {describeSizing(i.sizing, i.from)} when {describeCondition(i.from, i.to, i.direction, i.thresholdPct)}
              </div>
              <div className="meta">
                Baseline <span className="num">{i.baseline.ratio.toFixed(5)}</span>, switch at{" "}
                <span className="num">{i.triggerRatio.toFixed(5)}</span> {i.from} per {i.to}
              </div>
            </div>
            <div>
              {i.execution && !i.execution.error ? (
                <div style={{ fontSize: 13 }}>
                  <span className="num">{fmtNum(i.execution.inUi)}</span> {tokenSymbol(i.from)} <ArrowRight size={12} />{" "}
                  <span className="num">{fmtNum(i.execution.outUi)}</span> {tokenSymbol(i.to)}
                  <div className="meta">
                    <span className="num">{i.execution.shortfallBps <= 0 ? "+" : "-"}{Math.abs(i.execution.shortfallBps).toFixed(0)} bps</span> vs market
                    via {i.execution.route}
                  </div>
                </div>
              ) : e ? (
                <div style={{ fontSize: 13 }}>
                  <div className="move-stats">
                    <div>
                      <span className="k">Now</span>
                      <span className="num">{fmtMove(e.changePct)}</span>
                    </div>
                    <div>
                      <span className="k">Trigger</span>
                      <span className="num">{fmtMove(need)}</span>
                    </div>
                    <div>
                      <span className="k">Left</span>
                      <span className="num">{Math.max(0, i.thresholdPct - Math.abs(Math.min(0, i.direction === "cheaper" ? e.changePct : -e.changePct))).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="meter" aria-label={`${Math.round(e.progress * 100)}% of the way to the trigger`}>
                    <span style={{ width: `${Math.max(2, e.progress * 100)}%` }} />
                  </div>
                  {i.status === "ready" ? (
                    <div className="meta">Condition reached and every check passed. Confirm to switch.</div>
                  ) : e.conditionMet && (
                    <div className="meta">
                      {e.blockedBy
                        ? `Condition reached, waiting on: ${e.blockedBy}`
                        : `Condition reached. Confirming ${Math.min(e.streak, i.limits.confirmations)} of ${i.limits.confirmations} fresh price updates`}
                    </div>
                  )}
                </div>
              ) : (
                <span className="muted">Waiting for first evaluation</span>
              )}
            </div>
            <div className="intent-actions">
              <span className={`badge ${b.cls}`}>{b.text}</span>
              {i.status === "ready" && i.mode === "live" && (
                <button className="btn btn-primary" style={{ height: 32, fontSize: 13 }} onClick={() => onConfirm(i)} disabled={busyId === i.id}>
                  {busyId === i.id ? "Confirming" : "Confirm switch"}
                </button>
              )}
              {i.execution?.signature && (
                <a className="btn btn-ghost" href={`https://solscan.io/tx/${i.execution.signature}`} target="_blank" rel="noreferrer">
                  Transaction <ArrowSquareOut size={14} />
                </a>
              )}
              {active && (
                <button className="btn btn-ghost" onClick={() => onCancel(i)} disabled={busyId === i.id}>
                  Cancel
                </button>
              )}
              {i.execution && !i.execution.error && (
                <button className="btn btn-ghost" onClick={() => setReceipt(receipt === i.id ? null : i.id)} aria-expanded={receipt === i.id}>
                  Receipt {receipt === i.id ? <CaretUp size={12} /> : <CaretDown size={12} />}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>
                Log {open === i.id ? <CaretUp size={12} /> : <CaretDown size={12} />}
              </button>
            </div>
            {receipt === i.id && i.execution && <Receipt i={i} />}
            {open === i.id && (
              <ul className="events">
                {i.execution?.error && (
                  <li>
                    <time>error</time>
                    <span style={{ color: "var(--bad)" }}>{i.execution.error}</span>
                  </li>
                )}
                {[...i.events].reverse().map((ev, k) => (
                  <li key={k}>
                    <time>{time(ev.at)}</time>
                    <span style={{ color: ev.kind === "error" ? "var(--bad)" : ev.kind === "warn" ? "var(--warn)" : ev.kind === "success" ? "var(--good)" : undefined }}>
                      {ev.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
