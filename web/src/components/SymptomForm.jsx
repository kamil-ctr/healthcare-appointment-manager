import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

/** The step between hold and confirm. Confirm stays disabled until this submits. */
export default function SymptomForm({ appointmentId, onSubmitted }) {
  const { call } = useAuth();
  const [symptoms, setSymptoms] = useState('');
  const [duration, setDuration] = useState('');
  const [severity, setSeverity] = useState(5);
  const [existingConditions, setExistingConditions] = useState('');
  const [currentMedications, setCurrentMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!symptoms.trim()) {
      setError('Please describe your symptoms.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await call(`/appointments/${appointmentId}/symptoms`, {
        method: 'POST',
        body: {
          symptoms: symptoms.trim(),
          duration: duration.trim() || undefined,
          severity,
          existingConditions: existingConditions.trim() || undefined,
          currentMedications: currentMedications.trim() || undefined,
          allergies: allergies.trim() || undefined,
        },
      });
      onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const textareaClass = 'rounded-[var(--radius-card)] border border-ink/12 bg-panel p-2 text-sm';
  const labelClass = 'flex flex-col gap-1 text-sm';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-medium text-ink">Tell the doctor about your symptoms</p>

      <label className={labelClass}>
        <span className="font-medium text-ink">Symptoms</span>
        <textarea
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          required
          rows={3}
          className={textareaClass}
          placeholder="What's bothering you?"
        />
      </label>

      <label className={labelClass}>
        <span className="font-medium text-ink">How long has this been going on?</span>
        <input
          type="text"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className={textareaClass}
          placeholder="e.g. 3 days"
        />
      </label>

      <label className={labelClass}>
        <span className="font-medium text-ink">
          Severity: <span className="font-data">{severity}/10</span>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
          className="accent-signal"
        />
      </label>

      <label className={labelClass}>
        <span className="font-medium text-ink">Existing conditions</span>
        <textarea
          value={existingConditions}
          onChange={(e) => setExistingConditions(e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </label>

      <label className={labelClass}>
        <span className="font-medium text-ink">Current medications</span>
        <textarea
          value={currentMedications}
          onChange={(e) => setCurrentMedications(e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </label>

      <label className={labelClass}>
        <span className="font-medium text-ink">Allergies</span>
        <textarea
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </label>

      {error && <p className="text-sm text-urgent">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-[var(--radius-card)] bg-signal px-4 py-2 text-sm text-ground transition-colors hover:bg-signal/90 disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save symptoms'}
      </button>
    </form>
  );
}
