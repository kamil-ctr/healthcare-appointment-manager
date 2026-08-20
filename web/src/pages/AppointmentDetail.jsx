import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import AppointmentTimeline from '../components/AppointmentTimeline.jsx';
import PostVisitSummaryCard from '../components/PostVisitSummaryCard.jsx';

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
  const [appointment, setAppointment] = useState(null);

  useEffect(() => {
    call('/appointments').then((d) => {
      setAppointment(d.appointments.find((a) => a.id === id) || null);
    });
  }, [call, id]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl">{appointment ? appointment.doctorName : 'Appointment'}</h1>
      {appointment && (
        <>
          <p className="text-sm text-ink/60">{appointment.doctorSpecialisation}</p>
          <p className="mb-6 font-data text-sm text-ink/60">
            <time dateTime={appointment.startsAt}>{formatDateTime(appointment.startsAt)}</time>
          </p>
        </>
      )}

      {appointment?.status === 'completed' && (
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
