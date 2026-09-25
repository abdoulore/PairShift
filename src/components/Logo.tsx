import { useState } from "react";
import type { Asset } from "../../shared/assets";

// Issuer-hosted token logos: PreStocks for pre-IPO, Backed for xStocks.
const logoFor = (a: Asset) => a.image ?? `https://xstocks-metadata.backed.fi/logos/tokens/${a.ticker}x.png`;

export function Logo({ asset, size = 28 }: { asset: Asset; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span className="logo-fallback" style={{ width: size, height: size }} aria-hidden />;
  return <img className="logo" src={logoFor(asset)} alt="" width={size} height={size} loading="lazy" onError={() => setOk(false)} />;
}
