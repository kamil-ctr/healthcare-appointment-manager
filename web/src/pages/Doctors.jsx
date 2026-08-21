import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Skeleton from '../components/Skeleton.jsx';

export default function Doctors() {
  const { call } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const specialisation = searchParams.get('specialisation') || '';
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    const params = new URLSearchParams();
    if (specialisation) params.set('specialisation', specialisation);
    if (q) params.set('q', q);
    setState({ status: 'loading' });
    call(`/doctors${params.toString() ? `?${params}` : ''}`)
      .then((d) => setState({ status: 'ok', doctors: d.doctors }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, specialisation, q]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q);
    else next.delete('q');
    setSearchParams(next);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl">Find a doctor</h1>
      <p className="mb-6 text-sm text-ink/60">
        {specialisation ? `Showing ${specialisation}` : 'Showing all specialities'}
      </p>

      <form onSubmit={handleSearchSubmit} className="mb-6 flex max-w-md gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or speciality"
          className="flex-1 rounded-[var(--radius-card)] border border-line px-3 py-2 text-sm focus:border-primary"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-card)] border border-line px-4 py-2 text-sm hover:border-primary hover:text-primary"
        >
          Search
        </button>
        {specialisation && (
          <button
            type="button"
            onClick={() => setSearchParams(q ? { q } : {})}
            className="rounded-[var(--radius-card)] border border-line px-4 py-2 text-sm hover:border-primary hover:text-primary"
          >
            Clear filter
          </button>
        )}
      </form>

      {state.status === 'loading' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      )}
      {state.status === 'error' && <p className="text-sm text-urgent">{state.message}</p>}
      {state.status === 'ok' && state.doctors.length === 0 && (
        <div className="text-sm text-ink/60">
          <p>No doctors match.</p>
          {(q || specialisation) && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setSearchParams({});
              }}
              className="mt-2 text-primary underline hover:no-underline"
            >
              Clear search
            </button>
          )}
        </div>
      )}
      {state.status === 'ok' && state.doctors.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {state.doctors.map((d) => (
            <Link
              key={d.id}
              to={`/doctors/${d.id}`}
              className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-primary"
            >
              <Avatar name={d.fullName} />
              <div>
                <p className="font-medium">{d.fullName}</p>
                <p className="text-sm text-ink/60">{d.specialisation}</p>
                <p className="font-data text-xs text-ink/50">${d.consultationFee}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
