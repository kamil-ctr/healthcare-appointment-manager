import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import PreVisitSummaryCard from '../components/PreVisitSummaryCard.jsx';
import AppointmentTimeline from '../components/AppointmentTimeline.jsx';
import NotesForm from '../components/NotesForm.jsx';
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

const NOTES_ELIGIBLE_STATUSES = ['confirmed', 'completed'];

export default function DoctorAppointmentDetail() {
  const { id } = useParams();
  const { call } = useAuth();
  const [appointment, setAppointment] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    call('/appointments').then((d) => {
      setAppointment(d.appointments.find((a) => a.id === id) || null);
    });
  }, [call, id, reloadKey]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl">{appointment ? appointment.patientName : 'Appointment'}</h1>
      {appointment && (
        <p className="mb-6 font-data text-sm text-ink/60">
          <time dateTime={appointment.startsAt}>{formatDateTime(appointment.startsAt)}</time>
        </p>
      )}

      {/* Shown alongside the notes form, not navigated away from, so the
          doctor can write notes with the pre-visit context still visible. */}
      <PreVisitSummaryCard appointmentId={id} canRetry />

      {appointment && NOTES_ELIGIBLE_STATUSES.includes(appointment.status) && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-ink/70">Notes and prescriptions</h2>
          <NotesForm appointmentId={id} onSaved={() => setReloadKey((k) => k + 1)} />
        </section>
      )}

      {appointment?.status === 'completed' && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-ink/70">Post-visit summary</h2>
          <PostVisitSummaryCard appointmentId={id} canRetry />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-ink/70">Timeline</h2>
        <AppointmentTimeline appointmentId={id} />
      </section>
    </main>
  );
}
