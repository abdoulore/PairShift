import { CheckCircle, Clock, XCircle } from "@phosphor-icons/react";
import type { Check } from "../../shared/types";

export function ChecksList({ checks, loading }: { checks?: Check[]; loading?: boolean }) {
  if (!checks) {
    return (
      <ul className="checks" aria-busy={loading}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <span className="skeleton" style={{ width: 18, height: 18, borderRadius: 999 }} />
            <span className="skeleton" style={{ height: 30 }} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.id}>
          {c.pending ? (
            <Clock size={18} weight="bold" className="ic-pending" aria-label="Pending" />
          ) : c.ok ? (
            <CheckCircle size={18} weight="fill" className="ic-good" aria-label="Passing" />
          ) : (
            <XCircle size={18} weight="fill" className="ic-bad" aria-label="Failing" />
          )}
          <div>
            <div className="t">{c.label}</div>
            <div className="d">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
