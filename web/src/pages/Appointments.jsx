import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import SlotRail from '../components/SlotRail.jsx';
import HoldCountdown from '../components/HoldCountdown.jsx';
import GoogleCalendarConnect from '../components/GoogleCalendarConnect.jsx';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABEL = {
  held: 'Held',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled_by_patient: 'Cancelled by you',
  cancelled_by_doctor: 'Cancelled by doctor',
  cancelled_by_leave: 'Cancelled - doctor on leave',
  expired: 'Expired hold',
};

const ACTIVE_STATUSES = ['held', 'confirmed'];

// See Book.jsx for why this isn't date.toISOString().slice(0, 10).
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function Appointments() {
  const { call } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading' });
  const [reschedulingId, setReschedulingId] = useState(null);
  const [rescheduleSlots, setRescheduleSlots] = useState({});
  const [rescheduleHold, setRescheduleHold] = useState(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    call('/appointments')
      .then((d) => setState({ status: 'ok', appointments: d.appointments }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call]);

  useEffect(load, [load]);

  useEffect(() => {
    const g = searchParams.get('google');
    if (!g) return;
    if (g === 'connected') notify('Google Calendar connected.', 'success');
    else if (g === 'error') notify('Could not connect Google Calendar. Please try again.', 'error');
    setSearchParams(
      (prev) => {
        prev.delete('google');
        return prev;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, notify]);

  async function handleCancel(id) {
    try {
      await call(`/appointments/${id}/cancel`, {
        method: 'POST',
        body: { reason: 'Cancelled by patient' },
      });
      notify('Appointment cancelled.', 'success');
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function startReschedule(appointment) {
    setReschedulingId(appointment.id);
    setRescheduleHold(null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = toISODate(today);
    const to = toISODate(new Date(today.getTime() + 6 * 86400000));
    try {
      const d = await call(`/doctors/${appointment.doctorId}/slots?from=${from}&to=${to}`);
      setRescheduleSlots(d.slots);
    } catch (err) {
      notify(err.message, 'error');
      setReschedulingId(null);
    }
  }

  async function pickRescheduleSlot(appointmentId, startsAt) {
    try {
      const result = await call(`/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        body: { startsAt },
      });
      setRescheduleHold(result);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function confirmReschedule() {
    try {
      await call(`/appointments/${rescheduleHold.appointmentId}/confirm`, { method: 'POST' });
      notify('Appointment rescheduled and confirmed.', 'success');
      setReschedulingId(null);
      setRescheduleHold(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  if (state.status === 'loading') return <p className="p-10 text-sm text-ink/60">Loading...</p>;
  if (state.status === 'error') return <p className="p-10 text-sm text-urgent">{state.message}</p>;

  const upcoming = state.appointments.filter((a) => ACTIVE_STATUSES.includes(a.status));
  const past = state.appointments.filter((a) => !ACTIVE_STATUSES.includes(a.status));

  function renderAppointment(a) {
    const isRescheduling = reschedulingId === a.id;
    return (
      <li key={a.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to={`/appointments/${a.id}`} className="hover:underline">
            <p className="font-medium">{a.doctorName}</p>
            <p className="text-sm text-ink/60">{a.doctorSpecialisation}</p>
            <p className="font-data text-sm">
              <time dateTime={a.startsAt}>{formatDateTime(a.startsAt)}</time>
            </p>
            <p className="text-xs text-ink/50">{STATUS_LABEL[a.status] || a.status}</p>
          </Link>
          {ACTIVE_STATUSES.includes(a.status) && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => (isRescheduling ? setReschedulingId(null) : startReschedule(a))}
                className="rounded-[var(--radius-pill)] border border-line px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
              >
                {isRescheduling ? 'Close' : 'Reschedule'}
              </button>
              <button
                type="button"
                onClick={() => handleCancel(a.id)}
                className="rounded-[var(--radius-pill)] border border-urgent px-3 py-1.5 text-sm text-urgent hover:bg-urgent/5"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {isRescheduling && !rescheduleHold && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-ink/60">Pick a new time:</p>
            {Object.entries(rescheduleSlots).map(([date, slots]) => (
              <div key={date} className="mb-3">
                <p className="mb-1 font-data text-xs text-ink/50">{date}</p>
                <SlotRail slots={slots} selected={null} onSelect={(startsAt) => pickRescheduleSlot(a.id, startsAt)} />
              </div>
            ))}
          </div>
        )}

        {isRescheduling && rescheduleHold && (
          <div className="mt-4 rounded-[var(--radius-card)] border border-primary bg-primary-50 p-4">
            <p className="font-data text-sm">{formatDateTime(rescheduleHold.startsAt)}</p>
            <p className="mt-1">
              <HoldCountdown
                expiresAt={rescheduleHold.holdExpiresAt}
                onExpire={() => {
                  setRescheduleHold(null);
                  notify('Hold expired - pick another slot.', 'error');
                }}
              />
            </p>
            <button
              type="button"
              onClick={confirmReschedule}
              className="mt-3 rounded-[var(--radius-card)] bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
            >
              Confirm new time
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl">My appointments</h1>

      <GoogleCalendarConnect />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-ink/70">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink/60">No upcoming appointments. Book one from the doctors list.</p>
        ) : (
          <ul className="flex flex-col gap-3">{upcoming.map(renderAppointment)}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink/70">Past</h2>
        {past.length === 0 ? (
          <p className="text-sm text-ink/60">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">{past.map(renderAppointment)}</ul>
        )}
      </section>
    </main>
  );
}
