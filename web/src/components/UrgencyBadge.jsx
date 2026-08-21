import StatusBadge from './StatusBadge.jsx';

const CONFIG = {
  High: { tone: 'urgent', label: 'High' },
  Medium: { tone: 'caution', label: 'Medium' },
  Low: { tone: 'primary', label: 'Low' },
};

export default function UrgencyBadge({ urgency }) {
  const cfg = CONFIG[urgency];
  if (!cfg) {
    return <span className="text-xs text-ink/40">No urgency yet</span>;
  }
  return <StatusBadge tone={cfg.tone} label={cfg.label} />;
}
