import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';

const SPECIALITIES = [
  'General Medicine',
  'Cardiology',
  'Dermatology',
  'Pediatrics',
  'Orthopedics',
  'Neurology',
  'Gynecology',
  'Psychiatry',
];

/** Abstract schedule-grid mark instead of a stock photo - keeps the hero on-brand with zero licensing risk. */
function ScheduleMark() {
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden="true">
      <rect x="0" y="0" width="320" height="240" rx="6" fill="var(--color-primary-50)" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={24 + col * 96}
            y={24 + row * 54}
            width={row === col % 4 ? 72 : 60}
            height="28"
            rx="4"
            fill={row === 1 && col === 1 ? 'var(--color-primary)' : 'var(--color-surface)'}
            stroke="var(--color-line)"
          />
        ))
      )}
    </svg>
  );
}

export default function Home() {
  const { auth, call } = useAuth();
  const [doctors, setDoctors] = useState(null);

  useEffect(() => {
    if (!auth) {
      setDoctors(null);
      return;
    }
    call('/doctors')
      .then((d) => setDoctors(d.doctors.slice(0, 8)))
      .catch(() => setDoctors([]));
  }, [auth, call]);

  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:py-24">
        <div>
          <h1 className="text-4xl leading-tight sm:text-5xl">Book a doctor you trust, in minutes.</h1>
          <p className="mt-4 max-w-md text-ink/70">
            See real availability, hold a slot while you fill in your details, and get a
            confirmed appointment - no phone calls, no guesswork.
          </p>
          <Link
            to="/doctors"
            className="mt-6 inline-block rounded-[var(--radius-card)] bg-primary px-5 py-2.5 text-white transition-colors hover:bg-primary/90"
          >
            Find a doctor
          </Link>
        </div>
        <div className="aspect-[4/3] w-full">
          <ScheduleMark />
        </div>
      </section>

      <section className="border-y border-line bg-surface py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-4 text-lg">Browse by speciality</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {SPECIALITIES.map((s) => (
              <Link
                key={s}
                to={`/doctors?specialisation=${encodeURIComponent(s)}`}
                className="shrink-0 rounded-[var(--radius-pill)] border border-line px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-4 text-lg">Available doctors</h2>
        {!auth && (
          <p className="text-sm text-ink/60">
            <Link to="/login" className="text-primary underline">
              Sign in
            </Link>{' '}
            to browse available doctors.
          </p>
        )}
        {auth && doctors === null && <p className="text-sm text-ink/60">Loading...</p>}
        {auth && doctors?.length === 0 && <p className="text-sm text-ink/60">No doctors listed yet.</p>}
        {auth && doctors && doctors.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {doctors.map((d) => (
              <Link
                key={d.id}
                to={`/doctors/${d.id}`}
                className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-center transition-colors hover:border-primary"
              >
                <Avatar name={d.fullName} />
                <span className="text-sm font-medium">{d.fullName}</span>
                <span className="text-xs text-ink/60">{d.specialisation}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
