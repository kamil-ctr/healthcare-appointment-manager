import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Day 1 shell: proves the browser -> API -> Postgres path is wired up.
 * Patient / doctor / admin portals land on top of this from day 2.
 */
export default function App() {
  const [apiCheck, setApiCheck] = useState({ state: 'loading' });
  const [dbCheck, setDbCheck] = useState({ state: 'loading' });

  useEffect(() => {
    api('/health')
      .then((d) => setApiCheck({ state: 'ok', data: d }))
      .catch((e) => setApiCheck({ state: 'error', message: e.message }));
    api('/health/db')
      .then((d) => setDbCheck({ state: 'ok', data: d }))
      .catch((e) => setDbCheck({ state: 'error', message: e.message }));
  }, []);

  return (
    <main className="shell">
      <h1>Healthcare Appointment &amp; Follow-up Manager</h1>
      <p className="muted">Day 1 - infrastructure check</p>

      <ul className="checks">
        <li className={apiCheck.state}>
          <strong>API</strong>
          <span>
            {apiCheck.state === 'loading' && 'checking...'}
            {apiCheck.state === 'ok' && `reachable (up ${apiCheck.data.uptimeSeconds}s)`}
            {apiCheck.state === 'error' && apiCheck.message}
          </span>
        </li>
        <li className={dbCheck.state}>
          <strong>Database</strong>
          <span>
            {dbCheck.state === 'loading' && 'checking...'}
            {dbCheck.state === 'ok' && `connected (${dbCheck.data.latencyMs} ms)`}
            {dbCheck.state === 'error' && dbCheck.message}
          </span>
        </li>
      </ul>
    </main>
  );
}
