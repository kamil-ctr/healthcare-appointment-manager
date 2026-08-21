import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Skeleton from '../../components/Skeleton.jsx';

const STATUS_OPTIONS = ['', 'pending', 'processing', 'sent', 'failed'];
const TOPIC_OPTIONS = ['', 'email', 'calendar'];

const STATUS_TONE = { sent: 'primary', pending: 'caution', processing: 'caution', failed: 'urgent' };
const STATUS_TEXT = { sent: 'Sent', pending: 'Pending', processing: 'Processing', failed: 'Failed' };

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const select = 'rounded-[var(--radius-card)] border border-line px-3 py-2 text-sm focus:border-primary';

export default function AdminNotifications() {
  const { call } = useAuth();
  const { notify } = useToast();
  const [status, setStatus] = useState('');
  const [topic, setTopic] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading' });
  const [retryingId, setRetryingId] = useState(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (topic) params.set('topic', topic);
    params.set('page', String(page));
    call(`/admin/outbox?${params.toString()}`)
      .then((d) => setState({ status: 'ok', ...d }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [call, status, topic, page]);

  useEffect(load, [load]);

  async function handleRetry(id) {
    setRetryingId(id);
    try {
      await call(`/admin/outbox/${id}/retry`, { method: 'POST' });
      load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl">Admin - Notifications</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm">
          Status
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className={select}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || 'All'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Topic
          <select
            value={topic}
            onChange={(e) => {
              setPage(1);
              setTopic(e.target.value);
            }}
            className={select}
          >
            {TOPIC_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t || 'All'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      )}
      {state.status === 'error' && <p className="text-sm text-urgent">{state.message}</p>}

      {state.status === 'ok' && (
        <>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="px-4 py-2 font-medium">Topic</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Attempts</th>
                  <th className="px-4 py-2 font-medium">Next retry</th>
                  <th className="px-4 py-2 font-medium">Error</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-4 py-2 font-data">{row.topic}</td>
                    <td className="px-4 py-2">{row.eventType}</td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={STATUS_TONE[row.status] || 'neutral'} label={STATUS_TEXT[row.status] || row.status} />
                    </td>
                    <td className="px-4 py-2 font-data">
                      {row.attempts}/{row.maxAttempts}
                    </td>
                    <td className="px-4 py-2 font-data text-ink/60">
                      {row.status === 'pending' ? formatDateTime(row.nextRetryAt) : '-'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-ink/60" title={row.lastError || ''}>
                      {row.lastError || '-'}
                    </td>
                    <td className="px-4 py-2">
                      {row.status === 'failed' && (
                        <button
                          type="button"
                          onClick={() => handleRetry(row.id)}
                          disabled={retryingId === row.id}
                          className="rounded-[var(--radius-pill)] border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary-50 disabled:opacity-60"
                        >
                          {retryingId === row.id ? 'Retrying...' : 'Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {state.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-ink/60">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
            <span>
              {state.total} row{state.total === 1 ? '' : 's'} - page {state.page}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-[var(--radius-pill)] border border-line px-3 py-1.5 hover:border-primary hover:text-primary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page * state.pageSize >= state.total}
                className="rounded-[var(--radius-pill)] border border-line px-3 py-1.5 hover:border-primary hover:text-primary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
