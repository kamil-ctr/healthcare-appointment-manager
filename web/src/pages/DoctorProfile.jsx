import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Skeleton from '../components/Skeleton.jsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DoctorProfile() {
  const { id } = useParams();
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    call(`/doctors/${id}`)
      .then((d) => setState({ status: 'ok', doctor: d.doctor }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, id]);

  if (state.status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Skeleton variant="line" className="mb-3 w-1/3" />
        <Skeleton variant="card" />
      </main>
    );
  }
  if (state.status === 'error') return <p className="p-10 text-sm text-urgent">{state.message}</p>;

  const { doctor } = state;
  const byWeekday = WEEKDAYS.map((_, weekday) =>
    doctor.availability.filter((a) => a.weekday === weekday)
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-start gap-5">
        <Avatar name={doctor.fullName} size="lg" />
        <div>
          <h1 className="text-2xl">{doctor.fullName}</h1>
          <p className="text-ink/60">{doctor.specialisation}</p>
          {doctor.qualification && <p className="text-sm text-ink/50">{doctor.qualification}</p>}
          <p className="mt-2 font-data text-sm">${doctor.consultationFee} consultation</p>
        </div>
      </div>

      {doctor.bio && <p className="mt-6 max-w-2xl text-ink/80">{doctor.bio}</p>}

      <section className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="mb-3 text-lg">Weekly availability</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {WEEKDAYS.map((label, weekday) => (
            <li key={weekday} className="flex justify-between border-b border-line py-1.5 last:border-0">
              <span className="text-ink/70">{label}</span>
              <span className="font-data">
                {byWeekday[weekday].length === 0
                  ? 'Unavailable'
                  : byWeekday[weekday].map((b) => `${b.startTime}-${b.endTime}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Link
        to={`/book/${doctor.id}`}
        className="mt-8 inline-block rounded-[var(--radius-card)] bg-primary px-6 py-3 text-white transition-colors hover:bg-primary/90"
      >
        Book an appointment
      </Link>
    </main>
  );
}
