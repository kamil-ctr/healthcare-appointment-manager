const TONE_COLOR = {
  primary: 'bg-primary',
  caution: 'bg-caution',
  urgent: 'bg-urgent',
  neutral: 'bg-ink/30',
};

/** A solid square plus a text label - never colour alone (accessibility). Shared by every status/urgency display in the app. */
export default function StatusBadge({ tone = 'neutral', label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-2.5 w-2.5 shrink-0 ${TONE_COLOR[tone] || TONE_COLOR.neutral}`} aria-hidden="true" />
      {label}
    </span>
  );
}
