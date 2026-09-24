import { ASSET_BY_TICKER } from "../../shared/assets";
import type { AssetQuote, MarketSnapshot } from "../../shared/types";

const age = (t?: number) => {
  if (!t) return "n/a";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
const usd = (n?: number) => (n === undefined ? "n/a" : `$${n.toFixed(2)}`);
const bps = (n?: number) => (n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(0)} bps`);
const pct = (n?: number) => (n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${(n / 100).toFixed(1)}%`);
const srcLabel = (s?: string) => (s === "pyth" ? "Pyth" : s === "prestocks" ? "PreStocks" : "Fallback");

function Skeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 4 }, (_, i) => (
        <tr key={i}>
          <td colSpan={cols}>
            <div className="skeleton" style={{ height: 16 }} />
          </td>
        </tr>
      ))}
    </>
  );
}

const Name = ({ a }: { a: AssetQuote }) => (
  <td>
    <strong>{a.ticker}</strong>
    <span className="name">{ASSET_BY_TICKER[a.ticker]?.name}</span>
  </td>
);

export function MarketTable({ market }: { market?: MarketSnapshot }) {
  const pub = market?.assets.filter((a) => a.kind === "xstock") ?? [];
  const pre = market?.assets.filter((a) => a.kind === "prestock") ?? [];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>Pre-IPO tokens vs. their PreStocks mark</h2>
          <span className="sub">A positive premium means the token costs more than the company's reference price</span>
        </div>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="market">
            <thead>
              <tr>
                <th>Company</th>
                <th>PreStocks mark</th>
                <th>Token price</th>
                <th>Premium to mark</th>
                <th>Transfer fee</th>
              </tr>
            </thead>
            <tbody>
              {pre.map((a) => (
                <tr key={a.ticker}>
                  <Name a={a} />
                  <td>{usd(a.ref?.price)}</td>
                  <td>{usd(a.token?.price)}</td>
                  <td>{pct(a.pegBps)}</td>
                  <td>{a.transferFeeBps ? `${(a.transferFeeBps / 100).toFixed(0)}%` : "none"}</td>
                </tr>
              ))}
              {!market && <Skeleton cols={5} />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Public stocks: xStocks vs. the real share price</h2>
          <span className="sub">Reference from {pub.some((a) => a.sources?.ref === "pyth") ? "Pyth where entitled" : "fallback"}</span>
        </div>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="market">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Reference</th>
                <th>Source</th>
                <th>xStock</th>
                <th>Premium</th>
                <th>Reference age</th>
              </tr>
            </thead>
            <tbody>
              {pub.map((a) => (
                <tr key={a.ticker}>
                  <Name a={a} />
                  <td>{usd(a.ref?.price)}</td>
                  <td>{srcLabel(a.sources?.ref)}</td>
                  <td>{usd(a.token?.price)}</td>
                  <td>{bps(a.pegBps)}</td>
                  <td>{age(a.ref?.publishTime)}</td>
                </tr>
              ))}
              {!market && <Skeleton cols={6} />}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
