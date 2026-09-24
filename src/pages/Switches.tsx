import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { IntentList } from "../components/IntentList";
import { useAppData } from "../state/AppData";

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
      <IntentList intents={active} onCancel={cancel} onConfirm={confirmSwitch} busyId={busyId ?? undefined} />

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
