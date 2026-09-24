import type { Direction, Sizing } from "./types";

/** Price of one target share measured in source shares, from real-world reference prices. */
export function pairRatio(fromRef: number, toRef: number): number {
  return toRef / fromRef;
}

export function triggerRatio(baseline: number, direction: Direction, thresholdPct: number): number {
  const t = thresholdPct / 100;
  return direction === "cheaper" ? baseline * (1 - t) : baseline * (1 + t);
}

export function changePct(ratio: number, baseline: number): number {
  return (ratio / baseline - 1) * 100;
}

export function conditionMet(ratio: number, trigger: number, direction: Direction): boolean {
  return direction === "cheaper" ? ratio <= trigger : ratio >= trigger;
}

/** 0 at the baseline, 1 at (or past) the trigger, in the direction the user cares about. */
export function progress(ratio: number, baseline: number, direction: Direction, thresholdPct: number): number {
  if (thresholdPct <= 0) return 1;
  const c = changePct(ratio, baseline);
  const p = (direction === "cheaper" ? -c : c) / thresholdPct;
  return Math.max(0, Math.min(1, p));
}

// xStocks use Token-2022's scaled UI amount: ui = raw / 10^decimals * multiplier, and 1 ui token ~ 1 share.
export function uiFromRaw(raw: bigint | string, decimals: number, multiplier: number): number {
  return (Number(BigInt(raw)) / 10 ** decimals) * multiplier;
}

export function rawFromUi(ui: number, decimals: number, multiplier: number): bigint {
  return BigInt(Math.floor((ui / multiplier) * 10 ** decimals));
}

export function sharesForSizing(sizing: Sizing, fromRef: number): number {
  return sizing.kind === "usd" ? sizing.usd / fromRef : sizing.shares;
}

/** Shortfall of an executable output vs. what Pyth reference prices say is fair, in bps (positive = worse). */
export function shortfallBps(outUi: number, fairOutUi: number): number {
  return (1 - outUi / fairOutUi) * 10_000;
}

export function effectiveMultiplier(m: { multiplier: number; newMultiplier: number; effectiveAt: number }, nowSec: number): number {
  return nowSec >= m.effectiveAt ? m.newMultiplier : m.multiplier;
}

export const fmtUsd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (n: number, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const fmtNum = (n: number, digits = 4) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) });

export function describeCondition(from: string, to: string, direction: Direction, thresholdPct: number): string {
  return direction === "cheaper"
    ? `${to} becomes ${thresholdPct}% cheaper relative to ${from}`
    : `${to} outperforms ${from} by ${thresholdPct}%`;
}

export function describeSizing(sizing: Sizing, from: string): string {
  return sizing.kind === "usd" ? `${fmtUsd(sizing.usd, 0)} of ${from}` : `${sizing.shares} ${from}`;
}
