import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle, Clock, XCircle } from "@phosphor-icons/react";
import { ASSETS, type Asset } from "../../shared/assets";
import type { AssetQuote, Check } from "../../shared/types";
import { api, type Preview } from "../api";
import { BrandMark } from "../components/Brand";
import { usePoll, useReveal } from "../lib/hooks";
import { useAppData } from "../state/AppData";
import "./landing.css";

const HERO_DRAFT = {
  from: "TSLA",
  to: "SPACEX",
  sizing: { kind: "usd" as const, usd: 300 },
  direction: "cheaper" as const,
  thresholdPct: 5,
  mode: "paper" as const,
  text: "Move $300 from Tesla into SpaceX when SpaceX gets 5% cheaper relative to Tesla",
};

const logoFor = (a: Asset) => a.image ?? `https://xstocks-metadata.backed.fi/logos/tokens/${a.ticker}x.png`;
const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;

function Logo({ asset, size = 28 }: { asset: Asset; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span className="logo-fallback" style={{ width: size, height: size }} aria-hidden />;
  return <img className="logo" src={logoFor(asset)} alt="" width={size} height={size} loading="lazy" onError={() => setOk(false)} />;
}

function Sparkline({ series, trigger }: { series: { t: number; r: number }[]; trigger?: number }) {
  const W = 320;
  const H = 72;
  if (series.length < 2) return <div className="spark-empty">Collecting price history</div>;
  const vals = series.map((p) => p.r).concat(trigger ?? []);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (i: number) => (i / (series.length - 1)) * (W - 8) + 2;
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 12);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join("");
  const last = series[series.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="SpaceX priced in Tesla shares, recent history">
      {trigger !== undefined && <line x1={0} x2={W} y1={y(trigger)} y2={y(trigger)} stroke="var(--accent)" strokeDasharray="3 4" strokeWidth={1} />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(series.length - 1)} cy={y(last.r)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

function median5(s: { t: number; r: number }[]) {
  return s.map((p, i) => {
    const w = s.slice(Math.max(0, i - 2), i + 3).map((q) => q.r).sort((a, b) => a - b);
    return { t: p.t, r: w[Math.floor(w.length / 2)] };
  });
}

const CheckIcon = ({ c }: { c: Check }) =>
  c.pending ? <Clock size={16} weight="bold" className="ic-pending" /> : c.ok ? <CheckCircle size={16} weight="fill" className="ic-good" /> : <XCircle size={16} weight="fill" className="ic-bad" />;

/** The real product, running on live data: the hero's right side. */
function LivePreview() {
  const [p, setP] = useState<Preview>();
  const [series, setSeries] = useState<{ t: number; r: number }[]>([]);
  usePoll(() => api.preview(HERO_DRAFT).then(setP).catch(() => {}), 15_000);
  // The teaser smooths single-poll mark noise with a 5-point rolling median; the app chart shows raw data.
  usePoll(() => api.pair("TSLA", "SPACEX").then((r) => setSeries(median5(r.series.slice(-240)))).catch(() => {}), 30_000);
  const pick = (id: string) => p?.checks.find((c) => c.id === id);
  const shown = [pick("fresh"), pick("private"), pick("quote")].filter(Boolean) as Check[];
  return (
    <div className="preview card">
      <div className="preview-sentence">“{HERO_DRAFT.text}”</div>
      <div className="preview-nums">
        <div>
          <div className="k">Today</div>
          <div className="v num">{p ? p.ratio.toFixed(4) : "..."}</div>
          <div className="s">TSLA per SPACEX</div>
        </div>
        <div>
          <div className="k">Switches at</div>
          <div className="v num">{p ? p.trigger.toFixed(4) : "..."}</div>
          <div className="s">5% cheaper</div>
        </div>
      </div>
      <Sparkline series={series} trigger={p?.trigger} />
      <ul className="preview-checks">
        {shown.length
          ? shown.map((c) => (
              <li key={c.id}>
                <CheckIcon c={c} />
                <span>{c.label}</span>
              </li>
            ))
          : [0, 1, 2].map((i) => (
              <li key={i}>
                <span className="skeleton" style={{ width: "70%", height: 14 }} />
              </li>
            ))}
      </ul>
      <div className="preview-foot">
        <span className="muted">Live: Pyth for Tesla, PreStocks mark for SpaceX</span>
        <Link to="/app" className="text-link">
          Try it <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
    </div>
  );
}

const STEPS = [
  { title: "Say it", body: "Type the switch the way you would say it. PairShift pulls out the pair, the amount, the direction and the threshold." },
  { title: "Set the baseline", body: "It prices one stock in shares of the other from real-world prices, and marks the level that fires the switch." },
  { title: "Check everything", body: "Fresh prices, an open market, tokens close to their reference, no dividend in flight, slippage within your limit." },
  { title: "Switch in one transaction", body: "Pull, swap through Jupiter with a hard minimum out, deliver. If any step fails, nothing moves." },
];

const CHECK_GROUPS = [
  {
    title: "Prices",
    items: ["Pyth for public stocks, PreStocks marks for pre-IPO", "Fresh within 60 seconds, or 3 minutes for marks", "US market open for any public stock", "Pyth confidence interval tight"],
  },
  {
    title: "Tokens",
    items: ["xStocks within 1.5% of their stock", "Pre-IPO tokens within 10% of their mark", "No dividend or split in flight", "Not paused by the issuer"],
  },
  {
    title: "Execution",
    items: ["Trigger holds across 3 fresh price updates", "Slippage within your limit, after fees", "Hard minimum out, enforced on-chain"],
  },
];

const FAQ = [
  {
    q: "Does PairShift hold my funds?",
    a: "No. Automatic switches use an SPL approval for the exact amount, and tokens only move inside the switch transaction. One-tap switches are signed by you from your own wallet. You can revoke or cancel at any time.",
  },
  {
    q: "What does it cost?",
    a: "PairShift charges nothing. You pay Solana network fees, the pool spread, and PreStocks' 1% transfer fee on pre-IPO tokens. The app shows all of it before you arm a switch.",
  },
  {
    q: "Where do the prices come from?",
    a: "Pyth for public stocks and PreStocks marks for pre-IPO tokens. Stocks this deployment can't read from Pyth are priced by Backed via Jupiter and stay paper-only.",
  },
  {
    q: "What happens when the US market is closed?",
    a: "Switches involving a public stock wait. The tokens keep trading, but PairShift won't act on a stock price that isn't moving.",
  },
  {
    q: "Who can use it?",
    a: "xStocks and PreStocks are generally not available to US persons. Check each issuer's terms before you trade.",
  },
  {
    q: "Is it audited?",
    a: "No. PairShift is hackathon software. Start in paper mode, then use small amounts.",
  },
];

function PreIpoTile({ q, onPick }: { q: AssetQuote; onPick: () => void }) {
  const asset = ASSETS.find((a) => a.ticker === q.ticker)!;
  const above = (q.pegBps ?? 0) >= 0;
  return (
    <button className="tile" onClick={onPick}>
      <div className="tile-top">
        <Logo asset={asset} />
        <span className="tile-name">{asset.name}</span>
      </div>
      <div className="tile-prem num">
        {q.pegBps === undefined ? "..." : pct(q.pegBps)}
        {q.pegBps !== undefined && (above ? <ArrowUpRight size={16} weight="bold" /> : <ArrowDownRight size={16} weight="bold" />)}
      </div>
      <div className="tile-sub">{q.pegBps === undefined ? " " : above ? "above its mark" : "below its mark"}</div>
    </button>
  );
}

export function Landing() {
  const { market } = useAppData();
  const navigate = useNavigate();
  useReveal([Boolean(market)]);

  const pre = market?.assets.filter((a) => a.kind === "prestock") ?? [];
  const priciest = [...pre].filter((a) => a.pegBps !== undefined).sort((a, b) => b.pegBps! - a.pegBps!)[0];
  const priciestName = priciest ? ASSETS.find((a) => a.ticker === priciest.ticker)!.name : "OpenAI";
  const pub = ASSETS.filter((a) => a.kind === "xstock");
  const priv = ASSETS.filter((a) => a.kind === "prestock");

  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-wrap l-nav-row">
          <Link to="/" className="brand">
            <BrandMark />
            PairShift
          </Link>
          <nav className="l-links" aria-label="Main">
            <a href="#how">How it works</a>
            <Link to="/app/markets">Markets</Link>
          </nav>
          <Link to="/app" className="btn btn-primary btn-sm">
            Open app
          </Link>
        </div>
      </header>

      <main>
        <section className="l-wrap hero">
          <h1>Switch stocks when the relationship moves, not the price.</h1>
          <div className="hero-grid">
          <div className="hero-copy">
            <p>Rotate between tokenized public and pre-IPO stocks on Solana the moment one gets cheap relative to another.</p>
            <div className="hero-ctas">
              <Link to="/app" className="btn btn-primary">
                Open app
              </Link>
              <a href="#how" className="btn btn-quiet">
                How it works
              </a>
            </div>
          </div>
          <LivePreview />
          </div>
        </section>

        <section className="l-wrap l-section problem reveal">
          <h2>Rotating by hand is slow, and blind.</h2>
          <ol className="problem-list">
            <li>
              <span className="fig num">2 trades</span>
              <div>
                <h3>Sell to cash, then buy back</h3>
                <p>Every manual rotation leaves you exposed in the gap between two trades.</p>
              </div>
            </li>
            <li>
              <span className="fig num">24/7</span>
              <div>
                <h3>Tokens trade when stocks don't</h3>
                <p>At night and on weekends a token can drift from its stock, and you pay the drift.</p>
              </div>
            </li>
            <li>
              <span className="fig num">{priciest?.pegBps !== undefined ? pct(priciest.pegBps) : "+30%"}</span>
              <div>
                <h3>Premiums nobody checks</h3>
                <p>{priciestName} tokens trade that far above their PreStocks mark right now. Most buyers never look.</p>
              </div>
            </li>
          </ol>
        </section>

        <section id="how" className="l-section how-section reveal">
          <div className="l-wrap">
            <h2>From a sentence to a settled switch.</h2>
            <ol className="steps">
              {STEPS.map((s) => (
                <li key={s.title}>
                  <span className="dot" aria-hidden />
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="l-wrap l-section reveal">
          <div className="section-lead">
            <h2>Pre-IPO tokens rarely trade at their mark.</h2>
            <p>Live from PreStocks. PairShift won't buy far above a company's reference price, or sell far below it.</p>
          </div>
          <div className="tiles">
            {pre.length
              ? pre.map((q) => <PreIpoTile key={q.ticker} q={q} onPick={() => navigate(`/app?to=${q.ticker}`)} />)
              : Array.from({ length: 8 }, (_, i) => <div key={i} className="tile skeleton" style={{ height: 118 }} />)}
          </div>
          <Link to="/app/markets" className="text-link more">
            All markets <ArrowRight size={14} weight="bold" />
          </Link>
        </section>

        <section className="l-wrap l-section reveal">
          <div className="section-lead">
            <h2>Checked before every trade.</h2>
            <p>If any check fails, the switch waits. Your limits never loosen on their own.</p>
          </div>
          <div className="check-groups">
            {CHECK_GROUPS.map((g) => (
              <div key={g.title}>
                <h3>{g.title}</h3>
                <ul>
                  {g.items.map((it) => (
                    <li key={it}>
                      <CheckCircle size={16} weight="fill" className="ic-good" />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="l-wrap l-section reveal">
          <div className="section-lead">
            <h2>Your stock stays in your wallet until it switches.</h2>
          </div>
          <div className="ways">
            <div className="way">
              <h3>Automatic, for public stocks</h3>
              <p>
                Approve an exact amount once. When the trigger fires, a keeper sends one atomic transaction and the new stock lands in your wallet. Revoke any time.
              </p>
            </div>
            <div className="way">
              <h3>One tap, for pre-IPO</h3>
              <p>
                PreStocks charge a 1% transfer fee, so PairShift doesn't route them through a keeper. When everything passes you get a Ready alert and confirm the swap from
                your own wallet.
              </p>
            </div>
          </div>
        </section>

        <section className="l-wrap l-section reveal">
          <div className="section-lead">
            <h2>21 assets. Mix public and private.</h2>
            <p>Switch between any two: Tesla into SpaceX, the S&amp;P 500 into NVIDIA, OpenAI into Anthropic.</p>
          </div>
          <div className="coverage">
            <div>
              <h3>Public stocks, via Backed xStocks</h3>
              <div className="pills">
                {pub.map((a) => (
                  <span className="pill" key={a.ticker}>
                    <Logo asset={a} size={18} />
                    {a.ticker}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3>Pre-IPO companies, via PreStocks</h3>
              <div className="pills">
                {priv.map((a) => (
                  <span className="pill" key={a.ticker}>
                    <Logo asset={a} size={18} />
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="l-wrap l-section faq reveal">
          <h2>Questions</h2>
          <div className="faq-list">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="l-wrap cta-band reveal">
          <div>
            <h2>Describe your first switch.</h2>
            <p>Paper mode needs no wallet.</p>
          </div>
          <Link to="/app" className="btn btn-primary">
            Open app
          </Link>
        </section>
      </main>

      <footer className="l-wrap l-foot">
        <span>PairShift, built on Solana for Stocklana</span>
        <span className="muted">Prices from Pyth, PreStocks and Jupiter</span>
      </footer>
    </div>
  );
}
