const CONFIG = {
  High: { color: 'bg-urgent', label: 'High' },
  Medium: { color: 'bg-caution', label: 'Medium' },
  Low: { color: 'bg-primary', label: 'Low' },
};

/** A solid square plus a text label - never colour alone (accessibility). */
export default function UrgencyBadge({ urgency }) {
  const cfg = CONFIG[urgency];
  if (!cfg) {
    return <span className="text-xs text-ink/40">No urgency yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-2.5 w-2.5 shrink-0 ${cfg.color}`} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}
