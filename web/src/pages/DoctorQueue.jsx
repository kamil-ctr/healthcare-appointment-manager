import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import UrgencyBadge from '../components/UrgencyBadge.jsx';
import GoogleCalendarConnect from '../components/GoogleCalendarConnect.jsx';

// See Book.jsx for why this isn't date.toISOString().slice(0, 10).
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function summaryStatusLabel(status) {
  if (status === 'ready') return 'Summary ready';
  if (status === 'pending') return 'Summary preparing';
  if (status === 'failed') return 'Summary unavailable';
  return 'No symptom form';
}

/** The doctor's landing page: today's confirmed appointments, urgency-sorted. */
export default function DoctorQueue() {
  const { call, auth } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [date, setDate] = useState(toISODate(new Date()));
  const [state, setState] = useState({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    call(`/doctor/queue?date=${date}`)
      .then((d) => setState({ status: 'ok', queue: d.queue }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, date]);

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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl">Queue</h1>
      <p className="mb-6 text-sm text-ink/60">{auth.user.fullName}</p>

      <GoogleCalendarConnect />

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 font-data text-sm"
      />

      {state.status === 'loading' && <p className="text-sm text-ink/60">Loading...</p>}
      {state.status === 'error' && <p className="text-sm text-urgent">{state.message}</p>}
      {state.status === 'ok' && state.queue.length === 0 && (
        <p className="text-sm text-ink/60">No confirmed appointments for this day.</p>
      )}
      {state.status === 'ok' && state.queue.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.queue.map((item) => (
            <li key={item.appointmentId}>
              <Link
                to={`/doctor/appointments/${item.appointmentId}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-primary"
              >
                <div className="flex items-center gap-3">
                  <UrgencyBadge urgency={item.urgency} />
                  <div>
                    <p className="font-medium">{item.patientName}</p>
                    <p className="font-data text-sm text-ink/60">
                      <time dateTime={item.startsAt}>{formatTime(item.startsAt)}</time>
                    </p>
                  </div>
                </div>
                <span className="text-xs text-ink/50">{summaryStatusLabel(item.summaryStatus)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
