import { ASSETS } from "./assets";
import type { Direction, IntentDraft, ParseResult, Sizing } from "./types";

// Deterministic plain-English intent parser. Handles phrasings like:
//   "move $500 from SPY into NVDA when NVIDIA becomes 6% cheaper relative to the S&P 500"
//   "switch 2 shares of AAPL to MSFT if Microsoft underperforms Apple by 4%"
//   "when TSLA drops 5% vs the nasdaq, rotate $1,000 out of QQQ into Tesla"

const ALIAS_LIST = ASSETS.flatMap((a) => a.aliases.map((alias) => ({ alias, ticker: a.ticker }))).sort(
  (x, y) => y.alias.length - x.alias.length,
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NEG = /\b(cheaper|underperform\w*|drops?|dropped|falls?|fell|lags?|lagging|weaker|declines?|discount(?:ed)?|loses?|trails?|sinks?|dips?|down)\b/;
const POS = /\b(richer|more expensive|expensive|pricier|outperform\w*|rises?|rose|gains?|beats?|stronger|climbs?|rall(?:y|ies)|leads?|premium|pops?|jumps?|up)\b/;
const COND = /\b(when|whenever|if|once|as soon as|after)\b/;
const M = "⟦"; // ⟦
const N = "⟧"; // ⟧

function tagAssets(text: string): string {
  let out = text;
  for (const { alias, ticker } of ALIAS_LIST) {
    const re = new RegExp(`(?<![a-z0-9${M}])${esc(alias)}(?![a-z0-9${N}])`, "g");
    out = out.replace(re, `${M}${ticker}${N}`);
  }
  return out;
}

function mentions(tagged: string): string[] {
  return [...tagged.matchAll(new RegExp(`${M}([A-Z]+)${N}`, "g"))].map((m) => m[1]);
}

function splitClauses(tagged: string): { action: string; condition: string } {
  const m = COND.exec(tagged);
  if (!m) return { action: tagged, condition: "" };
  const before = tagged.slice(0, m.index).trim();
  const after = tagged.slice(m.index);
  if (before.length < 3) {
    // Condition first: "when X ..., move ..." / "if X ... then move ..."
    const cut = after.search(/,|\bthen\b/);
    if (cut > 0) return { condition: after.slice(0, cut), action: after.slice(cut + 1) };
    return { action: after, condition: after };
  }
  return { action: before, condition: after };
}

const A = `${M}([A-Z]+)${N}`;
const PAIR_PATTERNS: { re: RegExp; swap?: boolean }[] = [
  { re: new RegExp(`\\bfrom\\s+(?:my\\s+)?${A}.*?\\b(?:into|to|for|in)\\s+${A}`) },
  { re: new RegExp(`\\bout of\\s+(?:my\\s+)?${A}.*?\\b(?:into|to|for|in)\\s+${A}`) },
  { re: new RegExp(`\\b(?:sell|swap|switch|rotate|move|convert|exchange|trade|shift)\\b[^${M}]*?${A}\\s+(?:into|to|for)\\s+${A}`) },
  { re: new RegExp(`\\bsell\\b[^${M}]*?${A}.*?\\bbuy\\s+${A}`) },
  { re: new RegExp(`\\bbuy\\s+(?:[^${M}]*?)${A}\\s+(?:with|using)\\s+(?:my\\s+)?[^${M}]*?${A}`), swap: true },
  { re: new RegExp(`${A}\\s*(?:->|→|=>|to|into)\\s*${A}`) },
];

function num(s: string, suffix?: string): number {
  const n = parseFloat(s);
  if (suffix === "k") return n * 1_000;
  if (suffix === "m") return n * 1_000_000;
  return n;
}

export function parseIntent(input: string): ParseResult {
  const notes: string[] = [];
  const missing: string[] = [];
  const draft: Partial<IntentDraft> = { text: input };

  const text = input
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tagged = tagAssets(text);
  const { action, condition } = splitClauses(tagged);

  // Pair
  let from: string | undefined;
  let to: string | undefined;
  for (const { re, swap } of PAIR_PATTERNS) {
    const m = re.exec(action) ?? re.exec(tagged);
    if (m && m[1] !== m[2]) {
      [from, to] = swap ? [m[2], m[1]] : [m[1], m[2]];
      break;
    }
  }
  if (!from || !to) {
    const distinct = [...new Set(mentions(action).concat(mentions(tagged)))];
    if (distinct.length >= 2) {
      [from, to] = distinct;
      notes.push(`Assumed you are moving out of ${from} and into ${to}.`);
    }
  }
  if (from) draft.from = from;
  else missing.push("from");
  if (to) draft.to = to;
  else missing.push("to");

  // Size: dollars or shares
  let sizing: Sizing | undefined;
  const usd =
    new RegExp(`\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(k|m)?\\b`).exec(action) ??
    /\$\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/.exec(text) ??
    /(\d+(?:\.\d+)?)\s*(k)?\s*(?:usd|usdc|dollars|bucks)\b/.exec(text);
  if (usd) sizing = { kind: "usd", usd: num(usd[1], usd[2]) };
  else {
    const sh =
      /(\d+(?:\.\d+)?)\s*(?:shares?|units?|tokens?)\b/.exec(action) ??
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(?:of\\s+)?(?:my\\s+)?${A}`).exec(action);
    if (sh) sizing = { kind: "shares", shares: parseFloat(sh[1]) };
  }
  if (sizing) draft.sizing = sizing;
  else missing.push("amount");

  // Threshold: prefer a percentage inside the condition clause that is not a slippage setting
  const pctRe = /(\d+(?:\.\d+)?)\s*(?:%|percent|pct)/g;
  const pickPct = (s: string) =>
    [...s.matchAll(pctRe)].find((m) => !/slippage|slip|impact/.test(s.slice(Math.max(0, (m.index ?? 0) - 16), m.index)));
  const pct = pickPct(condition) ?? pickPct(tagged);
  if (pct) draft.thresholdPct = parseFloat(pct[1]);
  else missing.push("threshold");

  // Direction: whose move is described, and which way
  const clause = condition || tagged;
  const subject = mentions(clause)[0];
  const afterSubject = subject ? clause.slice(clause.indexOf(`${M}${subject}${N}`)) : clause;
  const neg = NEG.exec(afterSubject);
  const pos = POS.exec(afterSubject);
  let polarity: -1 | 1 | 0 = 0;
  if (neg && (!pos || neg.index < pos.index)) polarity = -1;
  else if (pos) polarity = 1;
  let direction: Direction = "cheaper";
  if (polarity !== 0 && subject && from && to) {
    const subjectSign = subject === to ? 1 : subject === from ? -1 : 1;
    direction = polarity * subjectSign < 0 ? "cheaper" : "richer";
  } else if (polarity === 0) {
    notes.push("No direction word found; assuming you want to buy the target after it gets cheaper.");
  }
  draft.direction = direction;

  // Optional extras
  if (/\b(paper|simulate|simulation|dry run|test mode)\b/.test(text)) draft.mode = "paper";
  const exp = /\b(?:within|for|expires? in|expiring in)\s+(\d+)\s*(day|days|week|weeks)\b/.exec(text);
  if (exp) draft.expiresInDays = parseInt(exp[1]) * (exp[2].startsWith("week") ? 7 : 1);
  const slip = /(?:slippage|slip)\D{0,12}(\d+(?:\.\d+)?)\s*(%|bps|basis points)/.exec(text);
  if (slip) {
    const bps = slip[2] === "%" ? parseFloat(slip[1]) * 100 : parseFloat(slip[1]);
    notes.push(`Max slippage set to ${bps} bps.`);
    (draft as any).maxSlippageBps = bps;
  }

  if (from && to && from === to) {
    missing.push("to");
    notes.push("Source and target are the same asset.");
  }
  return { draft, missing, notes };
}
