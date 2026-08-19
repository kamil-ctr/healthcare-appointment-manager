/**
 * Wraps a labelled input and renders the API's details.fields validation
 * error inline under it - pass the caught Error object as `error` and the
 * field's own name; it self-selects whether it was the offending field.
 */
export default function Field({ label, name, error, children }) {
  const invalid = Boolean(error?.details?.fields?.includes(name));

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {invalid && <span className="text-xs text-urgent">{error.message}</span>}
    </label>
  );
}
