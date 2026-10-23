const STATUS_TONE: Record<string, string> = {
  not_started: "neutral", in_progress: "progress", in_review: "review", changes_requested: "warn",
  blocked: "danger", done: "ok", cancelled: "muted",
  on_track: "progress", at_risk: "warn", achieved: "ok", not_achieved: "danger",
};

/** Status chip: colour is secondary, the text label always carries the meaning. */
export function StatusBadge({ code, label }: { code: string; label: string }) {
  return <span className={`badge badge--${STATUS_TONE[code] ?? "neutral"}`}>{label}</span>;
}

export function PriorityMark({ code, label }: { code: string | null; label: string }) {
  if (!code) return null;
  return <span className={`priority priority--${code}`}>{label}</span>;
}

export function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  return (
    <div className="progress" role="img" aria-label={label}>
      <div className="progress__track">
        {pct != null && <div className="progress__fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}
      </div>
      <span className="progress__label">{label}</span>
    </div>
  );
}
