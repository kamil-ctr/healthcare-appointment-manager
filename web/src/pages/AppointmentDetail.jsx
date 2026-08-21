import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import AppointmentTimeline from '../components/AppointmentTimeline.jsx';
import PostVisitSummaryCard from '../components/PostVisitSummaryCard.jsx';
import Skeleton from '../components/Skeleton.jsx';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Patient-side counterpart of DoctorAppointmentDetail.jsx - same timeline, patient's own view. */
export default function AppointmentDetail() {
  const { id } = useParams();
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    call('/appointments')
      .then((d) => {
        const appointment = d.appointments.find((a) => a.id === id);
        if (appointment) setState({ status: 'ok', appointment });
        else setState({ status: 'not-found' });
      })
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, id]);

  if (state.status === 'loading') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton variant="line" className="mb-3 w-1/2" />
        <Skeleton variant="card" />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-sm text-urgent">{state.message}</p>
      </main>
    );
  }

  if (state.status === 'not-found') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-sm text-ink/60">This appointment could not be found.</p>
      </main>
    );
  }

  const { appointment } = state;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl">{appointment.doctorName}</h1>
      <p className="text-sm text-ink/60">{appointment.doctorSpecialisation}</p>
      <p className="mb-6 font-data text-sm text-ink/60">
        <time dateTime={appointment.startsAt}>{formatDateTime(appointment.startsAt)}</time>
      </p>

      {appointment.status === 'completed' && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-ink/70">Visit summary</h2>
          <PostVisitSummaryCard appointmentId={id} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink/70">Timeline</h2>
        <AppointmentTimeline appointmentId={id} />
      </section>
    </main>
  );
}
