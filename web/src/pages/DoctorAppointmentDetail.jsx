import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import PreVisitSummaryCard from '../components/PreVisitSummaryCard.jsx';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DoctorAppointmentDetail() {
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
      <h1 className="mb-1 text-2xl">{appointment ? appointment.patientName : 'Appointment'}</h1>
      {appointment && (
        <p className="mb-6 font-data text-sm text-ink/60">
          <time dateTime={appointment.startsAt}>{formatDateTime(appointment.startsAt)}</time>
        </p>
      )}
      <PreVisitSummaryCard appointmentId={id} canRetry />
    </main>
  );
}
