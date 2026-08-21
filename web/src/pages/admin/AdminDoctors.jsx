import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Skeleton from '../../components/Skeleton.jsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const input = 'rounded-[var(--radius-card)] border border-ink/12 px-3 py-2 text-sm focus:border-signal';
const label = 'flex flex-col gap-1 text-sm';
const linkBtn = 'text-sm text-signal underline hover:no-underline';
const primaryBtn =
  'rounded-[var(--radius-card)] bg-signal px-4 py-2 text-sm text-ground transition-colors hover:bg-signal/90 disabled:opacity-60';

export default function AdminDoctors() {
  const [view, setView] = useState({ name: 'list' });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl">Admin - Doctors</h1>

      {view.name === 'list' && (
        <DoctorsList
          onCreate={() => setView({ name: 'create' })}
          onSelect={(id) => setView({ name: 'detail', id })}
        />
      )}
      {view.name === 'create' && (
        <CreateDoctorForm
          onCancel={() => setView({ name: 'list' })}
          onCreated={(id) => setView({ name: 'detail', id })}
        />
      )}
      {view.name === 'detail' && (
        <DoctorDetail doctorId={view.id} onBack={() => setView({ name: 'list' })} />
      )}
    </main>
  );
}

function DoctorsList({ onCreate, onSelect }) {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => {
    setState({ status: 'loading' });
    call(`/admin/doctors?includeInactive=${includeInactive}`)
      .then((d) => setState({ status: 'ok', doctors: d.doctors }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, includeInactive]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="accent-signal"
          />
          Show deactivated
        </label>
        <button onClick={onCreate} className={primaryBtn}>
          + New doctor
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      )}
      {state.status === 'error' && <p className="text-sm text-urgent">{state.message}</p>}
      {state.status === 'ok' && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-ink/12 bg-panel">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink/12 text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Specialisation</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {state.doctors.map((d) => (
                <tr key={d.id} className="border-b border-ink/12 last:border-0">
                  <td className="px-4 py-2">{d.fullName}</td>
                  <td className="px-4 py-2">{d.specialisation}</td>
                  <td className="px-4 py-2">{d.email}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={d.isActive ? 'primary' : 'neutral'} label={d.isActive ? 'Active' : 'Deactivated'} />
                  </td>
                  <td className="px-4 py-2">
                    <button className={linkBtn} onClick={() => onSelect(d.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {state.doctors.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink/60">
                    No doctors yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const EMPTY_DOCTOR_FORM = {
  email: '',
  password: '',
  fullName: '',
  phone: '',
  specialisation: '',
  qualification: '',
  consultationFee: '',
  slotMinutes: '30',
  timezone: 'Asia/Kolkata',
  bio: '',
};

function CreateDoctorForm({ onCancel, onCreated }) {
  const { call } = useAuth();
  const [form, setForm] = useState(EMPTY_DOCTOR_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        ...form,
        consultationFee: form.consultationFee === '' ? undefined : Number(form.consultationFee),
        slotMinutes: form.slotMinutes === '' ? undefined : Number(form.slotMinutes),
      };
      const { doctor } = await call('/admin/doctors', { method: 'POST', body });
      onCreated(doctor.id);
    } catch (err) {
      setError(err.message + (err.details ? ` (${JSON.stringify(err.details)})` : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <button className={linkBtn} onClick={onCancel}>
        &larr; Back to list
      </button>
      <h2 className="my-3 text-lg">New doctor</h2>
      <form className="flex max-w-lg flex-col gap-4" onSubmit={handleSubmit}>
        <label className={label}>
          Email
          <input type="email" value={form.email} onChange={set('email')} required className={input} />
        </label>
        <label className={label}>
          Temporary password
          <input type="password" value={form.password} onChange={set('password')} required className={input} />
        </label>
        <label className={label}>
          Full name
          <input value={form.fullName} onChange={set('fullName')} required className={input} />
        </label>
        <label className={label}>
          Phone
          <input value={form.phone} onChange={set('phone')} className={input} />
        </label>
        <label className={label}>
          Specialisation
          <input value={form.specialisation} onChange={set('specialisation')} required className={input} />
        </label>
        <label className={label}>
          Qualification
          <input value={form.qualification} onChange={set('qualification')} className={input} />
        </label>
        <label className={label}>
          Consultation fee
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.consultationFee}
            onChange={set('consultationFee')}
            className={input}
          />
        </label>
        <label className={label}>
          Slot length (minutes)
          <input
            type="number"
            min="5"
            max="240"
            value={form.slotMinutes}
            onChange={set('slotMinutes')}
            className={input}
          />
        </label>
        <label className={label}>
          Timezone
          <input value={form.timezone} onChange={set('timezone')} className={input} />
        </label>
        <label className={label}>
          Bio
          <textarea value={form.bio} onChange={set('bio')} className={input} />
        </label>
        {error && <p className="text-sm text-urgent">{error}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? 'Creating...' : 'Create doctor'}
        </button>
      </form>
    </section>
  );
}

function DoctorDetail({ doctorId, onBack }) {
  const { call } = useAuth();
  const { notify } = useToast();
  const [state, setState] = useState({ status: 'loading' });
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  function reload() {
    setState({ status: 'loading' });
    call(`/admin/doctors/${doctorId}`)
      .then((d) => setState({ status: 'ok', doctor: d.doctor }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }

  useEffect(reload, [call, doctorId]);

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      const result = await call(`/admin/doctors/${doctorId}`, { method: 'DELETE' });
      notify(
        `Doctor deactivated. ${result.futureActiveAppointments} future appointment(s) affected.`,
        'success'
      );
      setConfirmingDeactivate(false);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setDeactivating(false);
    }
  }

  if (state.status === 'loading') return <Skeleton variant="card" className="h-56" />;
  if (state.status === 'error') return <p className="text-sm text-urgent">{state.message}</p>;

  const { doctor } = state;

  return (
    <section>
      <button className={linkBtn} onClick={onBack}>
        &larr; Back to list
      </button>
      <h2 className="mt-3 text-lg">
        {doctor.fullName} <span className="text-ink/60">({doctor.specialisation})</span>
      </h2>
      <p className="mb-3 text-sm text-ink/60">
        {doctor.email} - {doctor.isActive ? 'active' : 'deactivated'}
      </p>
      {doctor.isActive && !confirmingDeactivate && (
        <button
          onClick={() => setConfirmingDeactivate(true)}
          className="rounded-[var(--radius-card)] border border-urgent px-3 py-1.5 text-sm text-urgent hover:bg-urgent/5"
        >
          Deactivate doctor
        </button>
      )}
      {confirmingDeactivate && (
        <div className="rounded-[var(--radius-card)] border border-urgent bg-urgent/5 p-3 text-sm">
          <p className="mb-2 text-ink">
            This deactivates {doctor.fullName} and cancels their future active appointments.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeactivate}
              disabled={deactivating}
              className="rounded-[var(--radius-pill)] bg-urgent px-3 py-1.5 text-sm text-white transition-colors hover:bg-urgent/90 disabled:opacity-60"
            >
              {deactivating ? 'Deactivating...' : 'Confirm deactivate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              disabled={deactivating}
              className="rounded-[var(--radius-pill)] border border-ink/12 px-3 py-1.5 text-sm hover:border-signal hover:text-signal disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <AvailabilityEditor doctorId={doctorId} availability={doctor.availability} onSaved={reload} />
      <LeaveForm doctorId={doctorId} upcomingLeave={doctor.upcomingLeave} onSaved={reload} />
    </section>
  );
}

function blocksToByWeekday(availability) {
  const byWeekday = WEEKDAYS.map(() => []);
  for (const block of availability) {
    byWeekday[block.weekday].push({ startTime: block.startTime, endTime: block.endTime });
  }
  for (const list of byWeekday) {
    if (list.length === 0) list.push({ startTime: '', endTime: '' });
  }
  return byWeekday;
}

function AvailabilityEditor({ doctorId, availability, onSaved }) {
  const { call } = useAuth();
  const [byWeekday, setByWeekday] = useState(() => blocksToByWeekday(availability));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setByWeekday(blocksToByWeekday(availability)), [availability]);

  function updateBlock(weekday, index, field, value) {
    setByWeekday((prev) => {
      const next = prev.map((list) => list.slice());
      next[weekday][index] = { ...next[weekday][index], [field]: value };
      return next;
    });
  }

  function addBlock(weekday) {
    setByWeekday((prev) => {
      const next = prev.map((list) => list.slice());
      next[weekday].push({ startTime: '', endTime: '' });
      return next;
    });
  }

  function removeBlock(weekday, index) {
    setByWeekday((prev) => {
      const next = prev.map((list) => list.slice());
      next[weekday].splice(index, 1);
      if (next[weekday].length === 0) next[weekday].push({ startTime: '', endTime: '' });
      return next;
    });
  }

  async function handleSave() {
    setError('');
    setBusy(true);
    const blocks = byWeekday.flatMap((list, weekday) =>
      list
        .filter((b) => b.startTime && b.endTime)
        .map((b) => ({ weekday, startTime: b.startTime, endTime: b.endTime }))
    );
    try {
      await call(`/admin/doctors/${doctorId}/availability`, { method: 'PUT', body: blocks });
      onSaved();
    } catch (err) {
      setError(err.message + (err.details ? ` ${JSON.stringify(err.details)}` : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-[var(--radius-card)] border border-ink/12 bg-panel p-5">
      <h3 className="mb-3 text-base">Weekly availability</h3>
      {WEEKDAYS.map((wLabel, weekday) => (
        <div className="flex gap-4 border-b border-ink/12 py-2 last:border-0" key={weekday}>
          <span className="w-24 shrink-0 pt-1.5 text-sm text-ink/70">{wLabel}</span>
          <div className="flex flex-col gap-1.5">
            {byWeekday[weekday].map((block, index) => (
              <span className="flex items-center gap-2" key={index}>
                <input
                  type="time"
                  value={block.startTime}
                  onChange={(e) => updateBlock(weekday, index, 'startTime', e.target.value)}
                  className={input}
                />
                <span className="text-sm text-ink/60">to</span>
                <input
                  type="time"
                  value={block.endTime}
                  onChange={(e) => updateBlock(weekday, index, 'endTime', e.target.value)}
                  className={input}
                />
                <button className={linkBtn} type="button" onClick={() => removeBlock(weekday, index)}>
                  remove
                </button>
              </span>
            ))}
            <button className={linkBtn} type="button" onClick={() => addBlock(weekday)}>
              + add block
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mt-2 text-sm text-urgent">{error}</p>}
      <button onClick={handleSave} disabled={busy} className={`${primaryBtn} mt-4`}>
        {busy ? 'Saving...' : 'Save availability'}
      </button>
    </div>
  );
}

function LeaveForm({ doctorId, upcomingLeave, onSaved }) {
  const { call } = useAuth();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const res = await call(`/admin/doctors/${doctorId}/leave`, {
        method: 'POST',
        body: { date, reason },
      });
      setResult(res);
      setDate('');
      setReason('');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(leaveDate) {
    await call(`/admin/doctors/${doctorId}/leave/${leaveDate}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="mt-6 rounded-[var(--radius-card)] border border-ink/12 bg-panel p-5">
      <h3 className="mb-3 text-base">Mark a leave day</h3>
      <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
        <label className={`${label} flex-1`}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={input} />
        </label>
        <label className={`${label} flex-1`}>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </label>
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? 'Saving...' : 'Mark leave'}
        </button>
      </form>
      {error && <p className="text-sm text-urgent">{error}</p>}
      {result && (
        <p className="text-sm text-signal">
          This cancelled {result.affectedAppointments} appointment(s) and queued{' '}
          {result.notificationsQueued} notification(s).
        </p>
      )}

      <h4 className="mb-1 mt-4 text-sm font-medium text-ink/70">Upcoming leave</h4>
      {upcomingLeave.length === 0 && <p className="text-sm text-ink/60">None scheduled.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {upcomingLeave.map((l) => (
          <li key={l.date}>
            <span className="font-data">{l.date}</span> {l.reason && `- ${l.reason}`}{' '}
            <button className={linkBtn} onClick={() => handleRemove(l.date)}>
              remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
