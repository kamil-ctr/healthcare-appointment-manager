import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Field from '../components/Field.jsx';

export default function Register() {
  const { register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(form);
      notify('Account created.', 'success');
      navigate('/appointments', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'rounded-[var(--radius-card)] border border-line px-3 py-2 outline-none focus:border-primary';

  return (
    <main className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="mb-1 text-2xl">Create your account</h1>
      <p className="mb-6 text-sm text-ink/60">Book appointments and track your visits.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Full name" name="fullName" error={error}>
          <input required value={form.fullName} onChange={set('fullName')} className={inputClass} />
        </Field>
        <Field label="Email" name="email" error={error}>
          <input type="email" required value={form.email} onChange={set('email')} className={inputClass} />
        </Field>
        <Field label="Phone (optional)" name="phone" error={error}>
          <input value={form.phone} onChange={set('phone')} className={inputClass} />
        </Field>
        <Field label="Password" name="password" error={error}>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={set('password')}
            className={inputClass}
          />
        </Field>

        {error && !error.details?.fields && <p className="text-sm text-urgent">{error.message}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--radius-card)] bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink/60">
        Already registered?{' '}
        <Link to="/login" className="text-primary underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
