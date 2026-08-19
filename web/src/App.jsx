import { useAuth } from './AuthContext.jsx';
import LoginPage from './LoginPage.jsx';
import AdminApp from './AdminApp.jsx';

/**
 * Routes on auth state alone (no router dependency, per the three-package
 * frontend budget). Patient / doctor portals land here from day 4+.
 */
export default function App() {
  const { auth, logout } = useAuth();

  if (!auth) return <LoginPage />;
  if (auth.user.role === 'admin') return <AdminApp />;

  return (
    <main className="shell">
      <h1>Healthcare Appointment &amp; Follow-up Manager</h1>
      <p className="muted">
        Signed in as {auth.user.fullName} ({auth.user.role}).
      </p>
      <p className="muted">The {auth.user.role} portal is not built yet.</p>
      <button onClick={logout}>Sign out</button>
    </main>
  );
}
