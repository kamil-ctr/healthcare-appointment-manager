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
      {slots.map((slot, i) => {
        const isSelected = selected === slot.startsAt;
        const isTaken = !slot.available;

        return (
          <button
            key={slot.startsAt}
            type="button"
            disabled={isTaken}
            onClick={() => onSelect(slot.startsAt)}
            aria-pressed={isSelected}
            style={{ animation: 'rail-in 240ms ease-out backwards', animationDelay: `${Math.min(i, 20) * 18}ms` }}
            className={[
              'rounded-[var(--radius-pill)] border px-3 py-2 font-data text-sm transition-colors',
              isTaken
                ? 'cursor-not-allowed border-ink/10 bg-ink/5 text-ink/35 line-through'
                : isSelected
                  ? 'border-signal bg-signal text-ground shadow-[0_0_0_1px_var(--color-signal),0_0_18px_-4px_var(--color-signal)]'
                  : 'border-signal/50 text-signal shadow-[0_0_10px_-5px_var(--color-signal)] hover:border-signal hover:bg-signal/10 hover:shadow-[0_0_14px_-4px_var(--color-signal)]',
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
