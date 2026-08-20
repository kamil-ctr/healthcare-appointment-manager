import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

const EVENT_LABEL = {
  held: 'Slot held',
  symptoms_submitted: 'Symptoms submitted',
  confirmed: 'Confirmed',
  cancelled_by_patient: 'Cancelled by patient',
  cancelled_by_doctor: 'Cancelled by doctor',
  cancelled_by_leave: 'Cancelled - doctor on leave',
  expired: 'Hold expired',
  rescheduled: 'Rescheduled',
  summary_ready: 'Pre-visit summary ready',
  summary_failed: 'Pre-visit summary failed',
  email_sent: 'Email sent',
  calendar_event_created: 'Calendar event created',
  calendar_event_deleted: 'Calendar event removed',
};

function actorLabel(actor) {
  if (actor === 'system') return 'System';
  const [role, id] = actor.split(':');
  const label = role ? role[0].toUpperCase() + role.slice(1) : actor;
  return id ? `${label} (${id.slice(0, 8)})` : label;
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** GET /api/appointments/:id/events, rendered as a vertical timeline - one line per event. */
export default function AppointmentTimeline({ appointmentId }) {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    call(`/appointments/${appointmentId}/events`)
      .then((d) => {
        if (!cancelled) setState({ status: 'ok', events: d.events });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [call, appointmentId]);

  if (state.status === 'loading') return <p className="text-sm text-ink/60">Loading timeline...</p>;
  if (state.status === 'error') return <p className="text-sm text-urgent">{state.message}</p>;
  if (state.events.length === 0) return <p className="text-sm text-ink/60">No events yet.</p>;

  return (
    <ol className="flex flex-col gap-4 border-l border-line pl-4">
      {state.events.map((ev, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary"
            aria-hidden="true"
          />
          <p className="font-data text-xs text-ink/50">
            <time dateTime={ev.createdAt}>{formatTimestamp(ev.createdAt)}</time>
          </p>
          <p className="text-sm font-medium">{EVENT_LABEL[ev.event] || ev.event}</p>
          <p className="text-xs text-ink/50">
            {actorLabel(ev.actor)}
            {ev.detail ? ` — ${ev.detail}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
