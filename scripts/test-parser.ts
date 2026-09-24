import { parseIntent } from "../shared/parser";

const cases: [string, Partial<{ from: string; to: string; direction: string; thresholdPct: number; usd: number; shares: number }>][] = [
  ["move $500 from SPY into NVDA when NVIDIA becomes 6% cheaper relative to the S&P 500", { from: "SPY", to: "NVDA", direction: "cheaper", thresholdPct: 6, usd: 500 }],
  ["switch 2 shares of AAPL to MSFT if Microsoft underperforms Apple by 4%", { from: "AAPL", to: "MSFT", direction: "cheaper", thresholdPct: 4, shares: 2 }],
  ["rotate $1,000 from TSLA to NVDA once NVDA outperforms Tesla by 5%", { from: "TSLA", to: "NVDA", direction: "richer", thresholdPct: 5, usd: 1000 }],
  ["swap $250 of QQQ for META when meta is 3% cheaper vs nasdaq", { from: "QQQ", to: "META", direction: "cheaper", thresholdPct: 3, usd: 250 }],
  ["when NVDA drops 5% relative to SPY, move $500 from SPY to NVDA", { from: "SPY", to: "NVDA", direction: "cheaper", thresholdPct: 5, usd: 500 }],
  ["sell $300 of Coinbase and buy Robinhood if COIN outperforms HOOD by 8%", { from: "COIN", to: "HOOD", direction: "cheaper", thresholdPct: 8, usd: 300 }],
  ["buy Google with $200 of my Amazon when alphabet lags amazon by 2.5 percent", { from: "AMZN", to: "GOOGL", direction: "cheaper", thresholdPct: 2.5, usd: 200 }],
  ["move 1.5 SPY into QQQ when the nasdaq is 2% cheaper than the s&p", { from: "SPY", to: "QQQ", direction: "cheaper", thresholdPct: 2, shares: 1.5 }],
  ["Move $1k out of the S&P 500 into Tesla once TSLA rallies 10% vs SPY", { from: "SPY", to: "TSLA", direction: "richer", thresholdPct: 10, usd: 1000 }],
];

let fail = 0;
for (const [text, want] of cases) {
  const { draft, missing, notes } = parseIntent(text);
  const got = {
    from: draft.from,
    to: draft.to,
    direction: draft.direction,
    thresholdPct: draft.thresholdPct,
    usd: draft.sizing?.kind === "usd" ? draft.sizing.usd : undefined,
    shares: draft.sizing?.kind === "shares" ? draft.sizing.shares : undefined,
  };
  const bad = Object.entries(want).filter(([k, v]) => (got as any)[k] !== v);
  if (bad.length) fail++;
  console.log(bad.length ? "FAIL" : "ok  ", text);
  if (bad.length) console.log("      want", want, "\n      got ", got, missing, notes);
}
console.log(fail ? `${fail} failing` : "all parser cases pass");
process.exit(fail ? 1 : 0);
