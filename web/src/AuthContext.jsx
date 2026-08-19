import { createContext, useCallback, useContext, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'healthcare.auth';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadStored);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuth(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
    const next = { token, user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
    return next;
  }, []);

  const register = useCallback(async ({ email, password, fullName, phone }) => {
    const { token, user } = await api('/auth/register', {
      method: 'POST',
      body: { email, password, fullName, phone },
    });
    const next = { token, user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
    return next;
  }, []);

  /** Wraps the shared api() helper with the current token; any 401 clears the session. */
  const call = useCallback(
    (path, opts = {}) =>
      api(path, { ...opts, token: auth?.token }).catch((err) => {
        if (err.status === 401) logout();
        throw err;
      }),
    [auth, logout]
  );

  return (
    <AuthContext.Provider value={{ auth, login, register, logout, call }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
