import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Field from '../components/Field.jsx';

function landingPageFor(role) {
  if (role === 'admin') return '/admin';
  if (role === 'patient') return '/appointments';
  return '/';
}

export default function Login() {
  const { login } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await login(email, password);
      notify('Signed in.', 'success');
      navigate(location.state?.from || landingPageFor(user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="mb-1 text-2xl">Sign in</h1>
      <p className="mb-6 text-sm text-ink/60">Welcome back.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email" name="email" error={error}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-[var(--radius-card)] border border-line px-3 py-2 outline-none focus:border-primary"
          />
        </Field>
        <Field label="Password" name="password" error={error}>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-[var(--radius-card)] border border-line px-3 py-2 outline-none focus:border-primary"
          />
        </Field>

        {error && !error.details?.fields && <p className="text-sm text-urgent">{error.message}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--radius-card)] bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink/60">
        New here?{' '}
        <Link to="/register" className="text-primary underline">
          Create a patient account
        </Link>
      </p>
    </main>
  );
}
