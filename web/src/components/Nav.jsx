import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Nav() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-ink/12 bg-panel/60 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="font-display text-lg font-bold text-ink">
          Clinic
        </Link>
        <div className="flex items-center gap-5 text-sm">
          {auth?.user.role !== 'doctor' && (
            <Link to="/doctors" className="text-ink hover:text-signal">
              Find a doctor
            </Link>
          )}
          {auth?.user.role === 'patient' && (
            <Link to="/appointments" className="text-ink hover:text-signal">
              My appointments
            </Link>
          )}
          {auth?.user.role === 'doctor' && (
            <Link to="/doctor" className="text-ink hover:text-signal">
              My queue
            </Link>
          )}
          {auth?.user.role === 'admin' && (
            <>
              <Link to="/admin" className="text-ink hover:text-signal">
                Admin
              </Link>
              <Link to="/admin/notifications" className="text-ink hover:text-signal">
                Notifications
              </Link>
            </>
          )}
          {auth ? (
            <>
              <span className="hidden text-ink/60 sm:inline">{auth.user.fullName}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-[var(--radius-pill)] border border-ink/12 px-3 py-1.5 hover:border-signal hover:text-signal"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-ink hover:text-signal">
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-[var(--radius-pill)] bg-signal px-3 py-1.5 text-ground hover:bg-signal/90"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
