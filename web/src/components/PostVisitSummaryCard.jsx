import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

function PrescriptionTable({ prescriptions }) {
  if (!prescriptions || prescriptions.length === 0) {
    return <p className="text-sm text-ink/60">No medications prescribed.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ink/50">
            <th className="pb-1 pr-3 font-medium">Medication</th>
            <th className="pb-1 pr-3 font-medium">Dose</th>
            <th className="pb-1 pr-3 font-medium">Frequency</th>
            <th className="pb-1 pr-3 font-medium">Duration</th>
            <th className="pb-1 font-medium">Instructions</th>
          </tr>
        </thead>
        <tbody>
          {prescriptions.map((p) => (
            <tr key={p.id ?? p.medicationName} className="border-t border-line">
              <td className="py-1.5 pr-3 font-medium">{p.medicationName}</td>
              <td className="py-1.5 pr-3 font-data">{p.dosage}</td>
              <td className="py-1.5 pr-3 font-data">{p.frequencyPerDay}x/day</td>
              <td className="py-1.5 pr-3 font-data">{p.durationDays}d</td>
              <td className="py-1.5">{p.instructions || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VisitNotesReadout({ visitNotes }) {
  if (!visitNotes) return null;
  return (
    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Clinical notes</dt>
        <dd>{visitNotes.clinicalNotes || 'Not recorded.'}</dd>
      </div>
      {visitNotes.diagnosis && (
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink/50">Diagnosis</dt>
          <dd>{visitNotes.diagnosis}</dd>
        </div>
      )}
      {visitNotes.followUpDate && (
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink/50">Follow-up</dt>
          <dd className="font-data">{visitNotes.followUpDate}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The AI rendering sits on TOP, but the real prescription table is always
 * shown below it (not only as a pending/failed fallback) - it is the
 * source of truth, the AI summary is a friendlier read of the same facts,
 * never a replacement for them.
 */
export default function PostVisitSummaryCard({ appointmentId, canRetry }) {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    call(`/appointments/${appointmentId}/post-visit-summary`)
      .then((data) => setState({ status: 'ok', data }))
      .catch((err) => setState({ status: 'error', message: err.message, code: err.code }));
  }, [call, appointmentId]);

  useEffect(load, [load]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await call(`/appointments/${appointmentId}/post-visit-summary/retry`, { method: 'POST' });
      load();
    } catch (err) {
      setState({ status: 'error', message: err.message, code: err.code });
    } finally {
      setRetrying(false);
    }
  }

  if (state.status === 'loading') return <p className="text-sm text-ink/60">Loading visit summary...</p>;
  if (state.status === 'error') {
    if (state.code === 'NOT_FOUND') {
      return <p className="text-sm text-ink/60">Visit notes have not been submitted for this appointment yet.</p>;
    }
    return <p className="text-sm text-urgent">{state.message}</p>;
  }

  const { data } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h3 className="mb-3 font-medium">Visit summary</h3>

        {data.status === 'ready' && (
          <>
            <p className="text-sm">{data.content.summary}</p>

            {data.content.medicationSchedule.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Medication schedule</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-ink/50">
                        <th className="pb-1 pr-3 font-medium">Medication</th>
                        <th className="pb-1 pr-3 font-medium">Dose</th>
                        <th className="pb-1 pr-3 font-medium">When</th>
                        <th className="pb-1 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.content.medicationSchedule.map((m, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="py-1.5 pr-3 font-medium">{m.medication}</td>
                          <td className="py-1.5 pr-3 font-data">{m.dose}</td>
                          <td className="py-1.5 pr-3 font-data">{m.when}</td>
                          <td className="py-1.5 font-data">{m.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.content.followUpSteps.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Follow-up steps</p>
                <ul className="list-disc pl-5 text-sm">
                  {data.content.followUpSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.content.whenToSeekHelp.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-caution">When to seek help</p>
                <ul className="list-disc pl-5 text-sm text-caution">
                  {data.content.whenToSeekHelp.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-4 text-xs text-ink/50">
              This summary is AI-generated from the doctor's notes to help you understand your visit - the
              prescription below is the authoritative record.
            </p>
          </>
        )}

        {data.status === 'pending' && <p className="text-sm text-ink/60">Summary is being prepared.</p>}

        {data.status === 'failed' && (
          <>
            <p className="text-sm text-urgent">Summary unavailable.</p>
            {canRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="mt-2 rounded-[var(--radius-pill)] border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary-50 disabled:opacity-60"
              >
                {retrying ? 'Retrying...' : 'Generate again'}
              </button>
            )}
          </>
        )}

        {data.status !== 'ready' && data.visitNotes && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Clinical notes (raw)</p>
            <VisitNotesReadout visitNotes={data.visitNotes} />
          </div>
        )}
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h3 className="mb-3 font-medium">Prescription</h3>
        <PrescriptionTable prescriptions={data.prescriptions} />
        <p className="mt-3 text-xs text-ink/50">This prescription list is the authoritative record from your doctor.</p>
      </div>
    </div>
  );
}
