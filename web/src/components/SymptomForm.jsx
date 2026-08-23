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
  const captionClass = 'text-xs text-ink/50';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-medium text-ink">Tell the doctor about your symptoms</p>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/50">Current symptoms</h3>
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            <span className="font-medium text-ink">What's bothering you right now?</span>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              required
              rows={3}
              className={textareaClass}
              placeholder="e.g. sharp pain in lower back since yesterday"
            />
            <span className={captionClass}>Describe the specific problem you're seeing the doctor for today.</span>
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
        </div>
      </div>

      <div className="border-t border-ink/12 pt-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/50">
          Background health information
        </h3>
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            <span className="font-medium text-ink">Any ongoing health conditions?</span>
            <textarea
              value={existingConditions}
              onChange={(e) => setExistingConditions(e.target.value)}
              rows={2}
              className={textareaClass}
              placeholder="e.g. diabetes, asthma, high blood pressure — leave blank if none"
            />
            <span className={captionClass}>
              Standing diagnoses you already have, not the problem you're here for today.
            </span>
          </label>

          <label className={labelClass}>
            <span className="font-medium text-ink">Current medications</span>
            <textarea
              value={currentMedications}
              onChange={(e) => setCurrentMedications(e.target.value)}
              rows={2}
              className={textareaClass}
              placeholder="e.g. metformin 500mg twice daily — leave blank if none"
            />
          </label>

          <label className={labelClass}>
            <span className="font-medium text-ink">Allergies</span>
            <textarea
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              rows={2}
              className={textareaClass}
              placeholder="e.g. penicillin — leave blank if none"
            />
          </label>
        </div>
      </div>

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
