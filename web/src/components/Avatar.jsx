// No doctor photographs anywhere in this app - a square initials block
// sidesteps stock/licensed image usage entirely, and reads honestly as a
// placeholder rather than pretending to be a real photo.
function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const SIZES = {
  sm: 'h-10 w-10 text-xs',
  md: 'h-16 w-16 text-lg',
  lg: 'h-24 w-24 text-2xl',
};

export default function Avatar({ name, size = 'md' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-primary-50 font-display font-bold text-primary ${SIZES[size]}`}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
