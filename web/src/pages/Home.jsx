import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Skeleton from '../components/Skeleton.jsx';

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

const DEMO_DAYS = ['MON', 'TUE', 'WED', 'THU'];
const DEMO_TIMES = ['09:00', '09:20', '09:40', '10:00', '10:20', '10:40'];
const DEMO_TAKEN = 2;
const DEMO_SELECTED = 4;

/** The hero shows the product, not a stock illustration - the same slot-rail language
    (glow on available, flat-strike on taken) real booking uses, one tick behind live. */
function HeroSlotDemo() {
  return (
    <div className="rounded-[var(--radius-card)] border border-ink/10 bg-panel/60 p-5 backdrop-blur-md">
      <div className="mb-4 flex gap-2 font-data text-xs uppercase tracking-wide text-ink/50">
        {DEMO_DAYS.map((d, i) => (
          <span
            key={d}
            className={
              i === 1
                ? 'rounded-[var(--radius-pill)] bg-signal px-2 py-0.5 text-ground'
                : 'px-2 py-0.5'
            }
          >
            {d}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {DEMO_TIMES.map((t, i) => (
          <span
            key={t}
            style={{ animation: 'rail-in 260ms ease-out backwards', animationDelay: `${i * 45}ms` }}
            className={
              i === DEMO_TAKEN
                ? 'rounded-[var(--radius-pill)] border border-ink/10 bg-ink/5 px-3 py-2 font-data text-sm text-ink/35 line-through'
                : i === DEMO_SELECTED
                  ? 'rounded-[var(--radius-pill)] border border-signal bg-signal px-3 py-2 font-data text-sm text-ground shadow-[0_0_0_1px_var(--color-signal),0_0_18px_-4px_var(--color-signal)]'
                  : 'rounded-[var(--radius-pill)] border border-signal/50 px-3 py-2 font-data text-sm text-signal shadow-[0_0_10px_-5px_var(--color-signal)]'
            }
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const HERO_COPY = {
  doctor: {
    heading: 'Your day, organized by urgency.',
    body: 'See who is on your schedule, review pre-visit summaries, and keep notes and prescriptions in one place.',
    ctaTo: '/doctor',
    ctaLabel: 'Go to your queue',
  },
  admin: {
    heading: 'Run the clinic from one place.',
    body: 'Manage doctors, availability, and leave days, and keep an eye on every notification going out.',
    ctaTo: '/admin',
    ctaLabel: 'Go to admin',
  },
  default: {
    heading: 'Book a doctor you trust, in minutes.',
    body: 'See real availability, hold a slot while you fill in your details, and get a confirmed appointment - no phone calls, no guesswork.',
    ctaTo: '/doctors',
    ctaLabel: 'Find a doctor',
  },
};

export default function Home() {
  const { auth, call } = useAuth();
  const [doctors, setDoctors] = useState(null);
  const hero = HERO_COPY[auth?.user.role] || HERO_COPY.default;

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
          <h1 className="text-4xl leading-tight sm:text-5xl">{hero.heading}</h1>
          <p className="mt-4 max-w-md text-ink/70">{hero.body}</p>
          <Link
            to={hero.ctaTo}
            className="mt-6 inline-block rounded-[var(--radius-card)] bg-signal px-5 py-2.5 text-ground transition-colors hover:bg-signal/90"
          >
            {hero.ctaLabel}
          </Link>
        </div>
        <HeroSlotDemo />
      </section>

      <section className="border-y border-ink/12 bg-panel py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-4 text-lg">Browse by speciality</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {SPECIALITIES.map((s) => (
              <Link
                key={s}
                to={`/doctors?specialisation=${encodeURIComponent(s)}`}
                className="shrink-0 rounded-[var(--radius-pill)] border border-ink/12 px-4 py-2 text-sm transition-colors hover:border-signal hover:text-signal"
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
            <Link to="/login" className="text-signal underline">
              Sign in
            </Link>{' '}
            to browse available doctors.
          </p>
        )}
        {auth && doctors === null && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
        )}
        {auth && doctors?.length === 0 && <p className="text-sm text-ink/60">No doctors listed yet.</p>}
        {auth && doctors && doctors.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {doctors.map((d) => (
              <Link
                key={d.id}
                to={`/doctors/${d.id}`}
                className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-ink/12 bg-panel p-4 text-center transition-colors hover:border-signal"
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
