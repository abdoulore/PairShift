import { useNavigate } from "react-router-dom";
import { MarketTable } from "../components/MarketTable";
import { useAppData } from "../state/AppData";

export function Markets() {
  const { market } = useAppData();
  const navigate = useNavigate();
  return (
    <main className="page">
      <div className="page-head">
        <h1>Markets</h1>
        <p>How far each token trades from its real-world reference. Pick one to start a switch into it.</p>
      </div>
      <MarketTable market={market} onPick={(ticker) => navigate(`/app?to=${ticker}`)} />
    </main>
  );
}
