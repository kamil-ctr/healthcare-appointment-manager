import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

/** Every doctors/appointments route needs a token - the API requires it too. */
export default function RequireAuth({ roles, children }) {
  const { auth } = useAuth();
  const location = useLocation();

  if (!auth) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (roles && !roles.includes(auth.user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
