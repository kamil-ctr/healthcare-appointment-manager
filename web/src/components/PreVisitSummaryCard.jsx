import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import UrgencyBadge from './UrgencyBadge.jsx';
import Skeleton from './Skeleton.jsx';

function SymptomFormReadout({ form }) {
  if (!form) return null;
  return (
    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Symptoms</dt>
        <dd>{form.symptoms}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Duration</dt>
        <dd>{form.duration || 'Not specified'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Severity</dt>
        <dd className="font-data">{form.severity != null ? `${form.severity}/10` : 'Not specified'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Existing conditions</dt>
        <dd>{form.existingConditions || 'None reported'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Current medications</dt>
        <dd>{form.currentMedications || 'None reported'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-ink/50">Allergies</dt>
        <dd>{form.allergies || 'None reported'}</dd>
      </div>
    </dl>
  );
}

/**
 * The fallback UI is the point of this component: 'pending' and 'failed'
 * both show the raw symptom form beneath, fully readable, so the doctor is
 * never blocked and never sees a spinner with nothing behind it.
 */
export default function PreVisitSummaryCard({ appointmentId, canRetry }) {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    call(`/appointments/${appointmentId}/pre-visit-summary`)
      .then((data) => setState({ status: 'ok', data }))
      .catch((err) => setState({ status: 'error', message: err.message, code: err.code }));
  }, [call, appointmentId]);

  useEffect(load, [load]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await call(`/appointments/${appointmentId}/pre-visit-summary/retry`, { method: 'POST' });
      load();
    } catch (err) {
      setState({ status: 'error', message: err.message, code: err.code });
    } finally {
      setRetrying(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <Skeleton variant="line" className="mb-3 w-1/3" />
        <Skeleton variant="card" />
      </div>
    );
  }

  if (state.status === 'error') {
    if (state.code === 'NOT_FOUND') {
      return <p className="text-sm text-ink/60">No symptom form has been submitted for this appointment.</p>;
    }
    return <p className="text-sm text-urgent">{state.message}</p>;
  }

  const { data } = state;

  if (data.status === 'ready') {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Pre-visit summary</h3>
          <UrgencyBadge urgency={data.urgency} />
        </div>
        <p className="text-sm">
          <span className="font-medium">Chief complaint: </span>
          {data.content.chiefComplaint}
        </p>
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">Suggested questions</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {data.content.suggestedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs text-ink/50">
          AI-generated triage support to help prepare for this visit - not a diagnosis.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="font-medium">Pre-visit summary</h3>

      {data.status === 'pending' && (
        <p className="mt-1 text-sm text-ink/60">Summary is being prepared.</p>
      )}

      {data.status === 'failed' && (
        <>
          <p className="mt-1 text-sm text-urgent">Summary unavailable.</p>
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

      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Symptom form (raw)</p>
        <SymptomFormReadout form={data.symptomForm} />
      </div>
    </div>
  );
}
