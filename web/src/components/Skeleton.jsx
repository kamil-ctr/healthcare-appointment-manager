const VARIANT_CLASS = {
  line: 'h-4 rounded-[var(--radius-pill)]',
  card: 'h-24 rounded-[var(--radius-card)]',
  row: 'h-9 rounded-[var(--radius-pill)]',
};

/** Pulse placeholder in the surface/line palette - stands in for any bare "Loading..." text. */
export default function Skeleton({ variant = 'line', className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`block w-full animate-pulse bg-line/50 ${VARIANT_CLASS[variant] || VARIANT_CLASS.line} ${className}`}
    />
  );
}
