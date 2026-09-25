import { useNavigate } from "react-router-dom";
import { ASSET_BY_TICKER } from "../../shared/assets";
import type { AssetQuote } from "../../shared/types";
import { Logo } from "../components/Logo";
import { MarketTable } from "../components/MarketTable";
import { useAppData } from "../state/AppData";

const usd = (n?: number) => (n === undefined ? "n/a" : `$${n.toFixed(2)}`);
const big = (n?: number) =>
  n === undefined ? "n/a" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
const age = (t?: number) => {
  if (!t) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

function PrivateCard({ q, onCreate }: { q: AssetQuote; onCreate: () => void }) {
  const asset = ASSET_BY_TICKER[q.ticker];
  const above = (q.pegBps ?? 0) >= 0;
  return (
    <div className="pm-card">
      <div className="pm-head">
        <Logo asset={asset} size={32} />
        <div>
          <div className="pm-name">{asset.name}</div>
          <div className="pm-sub">{q.ticker}</div>
        </div>
      </div>
      <div className="pm-prem">
        <span className="num">{q.pegBps === undefined ? "..." : `${above ? "+" : ""}${(q.pegBps / 100).toFixed(1)}%`}</span>
        <span className="pm-prem-label">{above ? "above its mark" : "below its mark"}</span>
      </div>
      <dl className="pm-facts">
        <div>
          <dt>Token price</dt>
          <dd className="num">{usd(q.token?.price)}</dd>
        </div>
        <div>
          <dt>PreStocks mark</dt>
          <dd className="num">{usd(q.ref?.price)}</dd>
        </div>
        <div>
          <dt>Implied valuation</dt>
          <dd className="num">{big(q.valuation?.implied)}</dd>
        </div>
        <div>
          <dt>Mark valuation</dt>
          <dd className="num">{big(q.valuation?.mark)}</dd>
        </div>
      </dl>
      <div className="pm-foot">
        <span className="muted">Mark updated {age(q.ref?.publishTime)}</span>
        <button className="btn btn-ghost" onClick={onCreate}>
          Create switch
        </button>
      </div>
    </div>
  );
}

export function Markets() {
  const { market } = useAppData();
  const navigate = useNavigate();
  const pre = market?.assets.filter((a) => a.kind === "prestock") ?? [];
  return (
    <main className="page">
      <div className="page-head">
        <h1>Markets</h1>
        <p>How far each token trades from its reference price. Start a switch into any of them.</p>
      </div>

      <div className="section-title first">
        <h2>Private markets, via PreStocks</h2>
        <span className="muted">Token price vs PreStocks mark, 1% transfer fee</span>
      </div>
      <div className="pm-grid">
        {pre.length
          ? pre.map((q) => <PrivateCard key={q.ticker} q={q} onCreate={() => navigate(`/app?to=${q.ticker}`)} />)
          : Array.from({ length: 8 }, (_, i) => <div key={i} className="pm-card skeleton" style={{ height: 230 }} />)}
      </div>

      <div style={{ height: 28 }} />
      <MarketTable market={market} only="xstock" onPick={(ticker) => navigate(`/app?to=${ticker}`)} />
    </main>
  );
}
