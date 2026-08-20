import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import Field from './Field.jsx';

const FREQUENCY_OPTIONS = [1, 2, 3, 4, 5, 6];
const emptyPrescription = () => ({
  medicationName: '',
  dosage: '',
  frequencyPerDay: 1,
  durationDays: 5,
  instructions: '',
});

/**
 * Doctor-side notes + repeatable prescription rows. POSTs the first time,
 * PATCHes on every save after that (detected by whether GET .../post-visit-
 * summary returned a 404 or a real row) - the doctor never has to know
 * which verb it is, the form just says "Save" then "Update".
 */
export default function NotesForm({ appointmentId, onSaved }) {
  const { call } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [prescriptions, setPrescriptions] = useState([emptyPrescription()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedNotice, setSavedNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    call(`/appointments/${appointmentId}/post-visit-summary`)
      .then((d) => {
        if (cancelled) return;
        setExists(true);
        if (d.visitNotes) {
          setClinicalNotes(d.visitNotes.clinicalNotes || '');
          setDiagnosis(d.visitNotes.diagnosis || '');
          setFollowUpDate(d.visitNotes.followUpDate || '');
        }
        if (d.prescriptions && d.prescriptions.length > 0) {
          setPrescriptions(
            d.prescriptions.map((p) => ({
              medicationName: p.medicationName,
              dosage: p.dosage,
              frequencyPerDay: p.frequencyPerDay,
              durationDays: p.durationDays,
              instructions: p.instructions || '',
            }))
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // NOT_FOUND just means no notes yet - the expected first-visit
        // state, not an error. The form stays at its empty defaults.
        if (err.code !== 'NOT_FOUND') setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [call, appointmentId]);

  function updatePrescription(index, patch) {
    setPrescriptions((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function addPrescription() {
    setPrescriptions((prev) => [...prev, emptyPrescription()]);
  }
  function removePrescription(index) {
    setPrescriptions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedNotice('');

    const body = {
      clinicalNotes: clinicalNotes.trim() || undefined,
      diagnosis: diagnosis.trim() || undefined,
      followUpDate: followUpDate || undefined,
      prescriptions: prescriptions
        .filter((p) => p.medicationName.trim() || p.dosage.trim())
        .map((p) => ({
          medicationName: p.medicationName.trim(),
          dosage: p.dosage.trim(),
          frequencyPerDay: Number(p.frequencyPerDay),
          durationDays: Number(p.durationDays),
          instructions: p.instructions.trim() || undefined,
        })),
    };

    try {
      await call(`/appointments/${appointmentId}/notes`, { method: exists ? 'PATCH' : 'POST', body });
      setExists(true);
      setSavedNotice(exists ? 'Notes updated.' : 'Notes saved - visit marked completed.');
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-ink/60">Loading notes...</p>;

  const canSubmit = Boolean(clinicalNotes.trim() || diagnosis.trim());
  const inputClass = 'rounded-[var(--radius-card)] border border-line bg-surface p-2 text-sm';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4"
    >
      <h3 className="font-medium">{exists ? 'Amend visit notes' : 'Visit notes'}</h3>

      <Field label="Clinical notes" name="clinicalNotes" error={error}>
        <textarea
          value={clinicalNotes}
          onChange={(e) => setClinicalNotes(e.target.value)}
          rows={4}
          className={inputClass}
        />
      </Field>

      <Field label="Diagnosis" name="diagnosis" error={error}>
        <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} className={inputClass} />
      </Field>

      <Field label="Follow-up date (optional)" name="followUpDate" error={error}>
        <input
          type="date"
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Prescriptions</p>
        <div className="flex flex-col gap-3">
          {prescriptions.map((p, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Medication</span>
                <input
                  value={p.medicationName}
                  onChange={(e) => updatePrescription(i, { medicationName: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Dose</span>
                <input
                  value={p.dosage}
                  onChange={(e) => updatePrescription(i, { dosage: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 500mg"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Frequency</span>
                <select
                  value={p.frequencyPerDay}
                  onChange={(e) => updatePrescription(i, { frequencyPerDay: Number(e.target.value) })}
                  className={inputClass}
                >
                  {FREQUENCY_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}x / day
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Duration (days)</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={p.durationDays}
                  onChange={(e) => updatePrescription(i, { durationDays: Number(e.target.value) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-ink/70">Instructions</span>
                <input
                  value={p.instructions}
                  onChange={(e) => updatePrescription(i, { instructions: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. after food"
                />
              </label>
              {prescriptions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePrescription(i)}
                  className="justify-self-start text-xs text-urgent hover:underline sm:col-span-2"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addPrescription} className="mt-2 text-sm text-primary hover:underline">
          + Add another medication
        </button>
      </div>

      {error?.details?.fields ? (
        <p className="text-sm text-urgent">Please fix: {error.details.fields.join(', ')}</p>
      ) : (
        error && <p className="text-sm text-urgent">{error.message}</p>
      )}
      {savedNotice && <p className="text-sm text-primary">{savedNotice}</p>}

      <button
        type="submit"
        disabled={!canSubmit || saving}
        className="self-start rounded-[var(--radius-card)] bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {saving ? 'Saving...' : exists ? 'Update notes' : 'Save notes'}
      </button>
    </form>
  );
}
