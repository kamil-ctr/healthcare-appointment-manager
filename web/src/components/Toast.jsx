import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ToastContext = createContext(null);
const EXIT_MS = 180;

function ToastItem({ toast, onDone }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!toast.leaving) return;
    setVisible(false);
    const t = setTimeout(onDone, EXIT_MS);
    return () => clearTimeout(t);
  }, [toast.leaving, onDone]);

  return (
    <div
      role="status"
      className={`rounded-[var(--radius-card)] border bg-surface px-4 py-2 text-sm transition-[opacity,transform] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
      } ${
        toast.tone === 'error'
          ? 'border-urgent text-urgent'
          : toast.tone === 'success'
            ? 'border-primary text-primary'
            : 'border-line text-ink'
      }`}
    >
      {toast.message}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  }, []);

  const notify = useCallback(
    (message, tone = 'default') => {
      const id = Math.random().toString(36).slice(2);
      setToasts((current) => [...current, { id, message, tone, leaving: false }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
