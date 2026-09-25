import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { IntentList } from "../components/IntentList";
import { useAppData } from "../state/AppData";

function EmptyState() {
  return (
    <div className="empty-rich">
      <h3>No active switches</h3>
      <p>PairShift watches the relationship between two assets and acts when your condition is met. Try this one:</p>
      <div className="empty-example">
        <div className="pair">
          OpenAI <ArrowRight size={14} weight="bold" /> Anthropic
        </div>
        <div className="cond">Move $100 when Anthropic becomes 10% cheaper relative to OpenAI</div>
      </div>
      <Link to="/app?from=OPENAI&to=ANTHROPIC&pct=10" className="btn btn-primary">
        Create this switch
      </Link>
      <p className="muted">Paper mode uses live market data and needs no wallet.</p>
    </div>
  );
}

export function Switches() {
  const wallet = useWallet();
  const { intents, cancel, confirmSwitch, busyId, readyCount } = useAppData();
  const active = intents.filter((i) => ["armed", "ready", "awaiting_approval", "executing"].includes(i.status));
  const past = intents.filter((i) => !active.includes(i));
  return (
    <main className="page">
      <div className="page-head row">
        <div>
          <h1>My switches</h1>
          <p>
            {readyCount > 0
              ? `${readyCount} ready to confirm. Every check passed; confirm in your wallet to switch.`
              : wallet.connected
                ? "Switches from this wallet and this browser."
                : "Paper switches from this browser. Connect a wallet to see live ones."}
          </p>
        </div>
        <Link to="/app" className="btn btn-primary">
          New switch
        </Link>
      </div>

      <div className="section-title first">
        <h2>Active</h2>
        <span className="muted">{active.length}</span>
      </div>
      <IntentList intents={active} onCancel={cancel} onConfirm={confirmSwitch} busyId={busyId ?? undefined} empty={<EmptyState />} />

      {past.length > 0 && (
        <>
          <div className="section-title">
            <h2>History</h2>
            <span className="muted">{past.length}</span>
          </div>
          <IntentList intents={past} onCancel={cancel} onConfirm={confirmSwitch} busyId={busyId ?? undefined} />
        </>
      )}
    </main>
  );
}
