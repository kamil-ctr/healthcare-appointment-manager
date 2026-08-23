import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import UrgencyBadge from './UrgencyBadge.jsx';
import Skeleton from './Skeleton.jsx';

function SymptomFormReadout({ form }) {
  if (!form) return null;
  return (
    <div className="mt-3 flex flex-col gap-4 text-sm">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">Current symptoms</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/50">What the patient reported</dt>
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
        </dl>
      </div>
      <div className="border-t border-ink/12 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">Background health information</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/50">Ongoing health conditions</dt>
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
      </div>
    </div>
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
      <div className="rounded-[var(--radius-card)] border border-ink/12 bg-panel p-4">
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
      <div className="rounded-[var(--radius-card)] border border-ink/12 bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Pre-visit summary</h3>
          <UrgencyBadge urgency={data.urgency} />
        </div>
        <p className="text-sm">
          <span className="font-medium">Chief complaint: </span>
          {data.content.chiefComplaint}
        </p>
        {data.content.symptomTimeline && (
          <p className="mt-2 text-sm">
            <span className="font-medium">Timeline: </span>
            {data.content.symptomTimeline}
          </p>
        )}
        {data.content.relevantHistory && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">Relevant history</p>
            <p className="mt-1 text-sm">{data.content.relevantHistory}</p>
          </div>
        )}
        {data.content.possibleConcernAreas && data.content.possibleConcernAreas.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">Possible concern areas</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {data.content.possibleConcernAreas.map((area, i) => (
                <li
                  key={i}
                  className="rounded-[var(--radius-pill)] border border-ink/12 px-2 py-0.5 text-xs text-ink/70"
                >
                  {area}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">Suggested questions</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {data.content.suggestedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
        <p className="mt-4 rounded-[var(--radius-card)] border border-signal/30 bg-signal/10 px-3 py-2 text-xs font-medium text-signal">
          AI-generated triage support to help prepare for this visit - not a diagnosis.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-ink/12 bg-panel p-4">
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
              className="mt-2 rounded-[var(--radius-pill)] border border-signal px-3 py-1.5 text-sm text-signal transition-colors hover:bg-signal/10 disabled:opacity-60"
            >
              {retrying ? 'Retrying...' : 'Generate again'}
            </button>
          )}
        </>
      )}

      <div className="mt-4 border-t border-ink/12 pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Symptom form (raw)</p>
        <SymptomFormReadout form={data.symptomForm} />
      </div>
    </div>
  );
}
