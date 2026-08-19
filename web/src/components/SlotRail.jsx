function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The signature element: times set in the mono face on a visible grid.
 * Taken slots stay visible (struck through, labelled) rather than hidden -
 * hiding scarcity would be dishonest about what's actually bookable.
 */
export default function SlotRail({ slots, selected, onSelect }) {
  if (slots.length === 0) {
    return <p className="text-sm text-ink/60">No slots for this day.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {slots.map((slot) => {
        const isSelected = selected === slot.startsAt;
        const isTaken = !slot.available;

        return (
          <button
            key={slot.startsAt}
            type="button"
            disabled={isTaken}
            onClick={() => onSelect(slot.startsAt)}
            aria-pressed={isSelected}
            className={[
              'rounded-[var(--radius-pill)] border px-3 py-2 font-data text-sm transition-colors',
              isTaken
                ? 'cursor-not-allowed border-line bg-wash text-ink/40 line-through'
                : isSelected
                  ? 'border-primary bg-primary text-white'
                  : 'border-primary text-primary hover:bg-primary-50',
            ].join(' ')}
          >
            <time dateTime={slot.startsAt}>{formatTime(slot.startsAt)}</time>
            {isTaken && <span className="ml-1.5 align-middle text-[10px] font-body uppercase tracking-wide">taken</span>}
          </button>
        );
      })}
    </div>
  );
}
