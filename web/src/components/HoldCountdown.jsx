import { useEffect, useState } from 'react';

/** Live mono countdown; turns caution under two minutes; fires onExpire at zero. */
export default function HoldCountdown({ expiresAt, onExpire }) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    const id = setInterval(() => {
      const next = target - Date.now();
      setRemainingMs(next);
      if (next <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const isCaution = totalSeconds < 120;

  return (
    <span className={`font-data text-base font-semibold tabular-nums ${isCaution ? 'text-caution' : 'text-ink'}`}>
      hold expires in {mm}:{ss}
    </span>
  );
}
