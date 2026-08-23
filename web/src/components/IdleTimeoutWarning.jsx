import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

/** Time of true inactivity before the warning appears. Not aggressive - a clinical app should
    not sign a doctor out mid-thought over a short pause. */
export const IDLE_WARNING_MS = 15 * 60 * 1000;

/** Once the warning is showing, how long the user has to interact before being signed out. */
export const IDLE_COUNTDOWN_SECONDS = 60;

// Real user input only - a background poll/health check never fires any of these, so it can
// never keep a session alive on its own.
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

// Activity events fire far more often than the idle timer needs resetting (mousemove alone can
// fire dozens of times a second) - this throttles resetIdleTimer() to at most once per window.
const ACTIVITY_THROTTLE_MS = 1000;

/**
 * App-wide idle sign-out. Mounted once at the root so it survives route changes and applies to
 * every role identically. Reuses AuthContext's own logout() - the same clear-token-and-reset-
 * state path the 401 handler already uses - rather than duplicating that logic here.
 */
export default function IdleTimeoutWarning() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(null); // null = warning not showing

  const warningTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const lastActivityRef = useRef(0);

  const clearTimers = useCallback(() => {
    clearTimeout(warningTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    warningTimerRef.current = null;
    countdownIntervalRef.current = null;
  }, []);

  const handleLogout = useCallback(() => {
    clearTimers();
    setSecondsLeft(null);
    logout();
    navigate('/login', { replace: true });
  }, [clearTimers, logout, navigate]);

  const startCountdown = useCallback(() => {
    setSecondsLeft(IDLE_COUNTDOWN_SECONDS);
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          handleLogout();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [handleLogout]);

  const scheduleWarning = useCallback(() => {
    clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(startCountdown, IDLE_WARNING_MS);
  }, [startCountdown]);

  /** Dismisses any active warning and restarts the full idle window - shared by real activity
      and the "Stay signed in" button, so either path resets the same way. */
  const resetIdleTimer = useCallback(() => {
    clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = null;
    setSecondsLeft(null);
    scheduleWarning();
  }, [scheduleWarning]);

  useEffect(() => {
    if (!auth) {
      clearTimers();
      setSecondsLeft(null);
      return undefined;
    }

    function handleActivity() {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      resetIdleTimer();
    }

    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, handleActivity, { passive: true });
    resetIdleTimer();

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, handleActivity);
      clearTimers();
    };
  }, [auth, resetIdleTimer, clearTimers]);

  if (secondsLeft === null) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-xs rounded-[var(--radius-card)] border border-signal/40 bg-panel px-4 py-3 shadow-lg">
      <p className="text-sm text-ink">
        You'll be signed out in <span className="font-data font-medium">{secondsLeft}s</span> due to
        inactivity.
      </p>
      <button
        type="button"
        onClick={resetIdleTimer}
        className="mt-2 rounded-[var(--radius-pill)] bg-signal px-3 py-1.5 text-sm text-ground transition-colors hover:bg-signal/90"
      >
        Stay signed in
      </button>
    </div>
  );
}
