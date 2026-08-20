import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

/**
 * A quiet inline card, never a blocking modal - connection status, the
 * connected address, and connect/disconnect. Used on both the patient
 * appointments page and the doctor queue (each role's natural "account
 * area" in this app - there's no separate settings page).
 */
export default function GoogleCalendarConnect() {
  const { call } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call('/google/status')
      .then((d) => setState({ status: 'ok', ...d }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call]);

  useEffect(load, [load]);

  async function handleConnect() {
    setBusy(true);
    try {
      const { url } = await call('/google/connect');
      window.location.href = url;
    } catch (err) {
      setBusy(false);
      window.alert(err.message);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await call('/google/disconnect', { method: 'DELETE' });
      load();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Never block the page on this - if it can't load, it just doesn't render.
  if (state.status === 'loading' || state.status === 'error') return null;

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
      <p className="font-medium">Google Calendar</p>
      {state.connected ? (
        <>
          <p className="mt-1 text-ink/60">
            Connected as <span className="font-data">{state.googleEmail}</span>. Confirmed
            appointments are added to your calendar automatically.
          </p>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy}
            className="mt-3 rounded-[var(--radius-pill)] border border-line px-3 py-1.5 text-sm transition-colors hover:border-urgent hover:text-urgent disabled:opacity-60"
          >
            {busy ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-ink/60">
            Connect your Google account to have confirmed appointments added to your calendar
            automatically.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            className="mt-3 rounded-[var(--radius-card)] bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        </>
      )}
    </div>
  );
}
