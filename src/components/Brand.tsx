/** The Tandem T: two seats (one solid, one lighter) on a single stem. Two positions, one decision. */
export function TandemMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <rect x="9" y="12" width="21" height="11" rx="5.5" />
      <rect x="34" y="12" width="21" height="11" rx="5.5" fillOpacity="0.45" />
      <rect x="26.5" y="27" width="11" height="26" rx="5.5" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <TandemMark size={19} />
    </span>
  );
}
