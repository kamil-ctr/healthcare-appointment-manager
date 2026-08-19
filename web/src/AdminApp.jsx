import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminApp() {
  const { auth, logout } = useAuth();
  const [view, setView] = useState({ name: 'list' });

  return (
    <main className="shell wide">
      <header className="topbar">
        <h1>Admin - Doctors</h1>
        <div>
          <span className="muted">{auth.user.email}</span>
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

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
      <div className="row-between">
        <label className="inline">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show deactivated
        </label>
        <button onClick={onCreate}>+ New doctor</button>
      </div>

      {state.status === 'loading' && <p className="muted">Loading...</p>}
      {state.status === 'error' && <p className="error">{state.message}</p>}
      {state.status === 'ok' && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Specialisation</th>
              <th>Email</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.doctors.map((d) => (
              <tr key={d.id}>
                <td>{d.fullName}</td>
                <td>{d.specialisation}</td>
                <td>{d.email}</td>
                <td>{d.isActive ? 'active' : 'deactivated'}</td>
                <td>
                  <button className="link" onClick={() => onSelect(d.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
            {state.doctors.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No doctors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
      <button className="link" onClick={onCancel}>
        &larr; Back to list
      </button>
      <h2>New doctor</h2>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Temporary password
          <input type="password" value={form.password} onChange={set('password')} required />
        </label>
        <label>
          Full name
          <input value={form.fullName} onChange={set('fullName')} required />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={set('phone')} />
        </label>
        <label>
          Specialisation
          <input value={form.specialisation} onChange={set('specialisation')} required />
        </label>
        <label>
          Qualification
          <input value={form.qualification} onChange={set('qualification')} />
        </label>
        <label>
          Consultation fee
          <input type="number" min="0" step="0.01" value={form.consultationFee} onChange={set('consultationFee')} />
        </label>
        <label>
          Slot length (minutes)
          <input type="number" min="5" max="240" value={form.slotMinutes} onChange={set('slotMinutes')} />
        </label>
        <label>
          Timezone
          <input value={form.timezone} onChange={set('timezone')} />
        </label>
        <label>
          Bio
          <textarea value={form.bio} onChange={set('bio')} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create doctor'}
        </button>
      </form>
    </section>
  );
}

function DoctorDetail({ doctorId, onBack }) {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });

  function reload() {
    setState({ status: 'loading' });
    call(`/admin/doctors/${doctorId}`)
      .then((d) => setState({ status: 'ok', doctor: d.doctor }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }

  useEffect(reload, [call, doctorId]);

  async function handleDeactivate() {
    const result = await call(`/admin/doctors/${doctorId}`, { method: 'DELETE' });
    window.alert(
      `Doctor deactivated. Future active appointments affected: ${result.futureActiveAppointments}`
    );
    reload();
  }

  if (state.status === 'loading') return <p className="muted">Loading...</p>;
  if (state.status === 'error') return <p className="error">{state.message}</p>;

  const { doctor } = state;

  return (
    <section>
      <button className="link" onClick={onBack}>
        &larr; Back to list
      </button>
      <h2>
        {doctor.fullName} <span className="muted">({doctor.specialisation})</span>
      </h2>
      <p className="muted">
        {doctor.email} - {doctor.isActive ? 'active' : 'deactivated'}
      </p>
      {doctor.isActive && (
        <button className="danger" onClick={handleDeactivate}>
          Deactivate doctor
        </button>
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
    <div className="panel">
      <h3>Weekly availability</h3>
      {WEEKDAYS.map((label, weekday) => (
        <div className="weekday-row" key={weekday}>
          <span className="weekday-label">{label}</span>
          <div className="weekday-blocks">
            {byWeekday[weekday].map((block, index) => (
              <span className="block-inputs" key={index}>
                <input
                  type="time"
                  value={block.startTime}
                  onChange={(e) => updateBlock(weekday, index, 'startTime', e.target.value)}
                />
                <span>to</span>
                <input
                  type="time"
                  value={block.endTime}
                  onChange={(e) => updateBlock(weekday, index, 'endTime', e.target.value)}
                />
                <button className="link" type="button" onClick={() => removeBlock(weekday, index)}>
                  remove
                </button>
              </span>
            ))}
            <button className="link" type="button" onClick={() => addBlock(weekday)}>
              + add block
            </button>
          </div>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <button onClick={handleSave} disabled={busy}>
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
    <div className="panel">
      <h3>Mark a leave day</h3>
      <form className="form inline-form" onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Mark leave'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="ok">
          This cancelled {result.affectedAppointments} appointment(s) and queued{' '}
          {result.notificationsQueued} notification(s).
        </p>
      )}

      <h4>Upcoming leave</h4>
      {upcomingLeave.length === 0 && <p className="muted">None scheduled.</p>}
      <ul className="plain-list">
        {upcomingLeave.map((l) => (
          <li key={l.date}>
            {l.date} {l.reason && `- ${l.reason}`}{' '}
            <button className="link" onClick={() => handleRemove(l.date)}>
              remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
