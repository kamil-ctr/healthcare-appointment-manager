import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import SlotRail from '../components/SlotRail.jsx';
import HoldCountdown from '../components/HoldCountdown.jsx';
import SymptomForm from '../components/SymptomForm.jsx';

// NOT date.toISOString().slice(0, 10) - that converts to UTC first, which
// silently shifts the calendar date by a day on any non-UTC-offset
// timezone (the exact bug class caught server-side on Day 3/4 already).
// Local getters keep this the date the user actually sees on screen.
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextSevenDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * 86400000));
}

export default function Book() {
  const { doctorId } = useParams();
  const { call } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const dateOptions = useMemo(nextSevenDays, []);
  const [selectedDate, setSelectedDate] = useState(toISODate(dateOptions[0]));
  const [doctor, setDoctor] = useState(null);
  const [slotsByDay, setSlotsByDay] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [hold, setHold] = useState(null); // { appointmentId, startsAt, endsAt, holdExpiresAt }
  const [holdExpiredNotice, setHoldExpiredNotice] = useState(false);
  const [symptomsSubmitted, setSymptomsSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    call(`/doctors/${doctorId}`).then((d) => setDoctor(d.doctor));
  }, [call, doctorId]);

  function refetchSlots() {
    setLoadingSlots(true);
    const from = toISODate(dateOptions[0]);
    const to = toISODate(dateOptions[dateOptions.length - 1]);
    call(`/doctors/${doctorId}/slots?from=${from}&to=${to}`)
      .then((d) => setSlotsByDay(d.slots))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSlots(false));
  }

  useEffect(refetchSlots, [call, doctorId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectSlot(startsAt) {
    setError('');
    setHoldExpiredNotice(false);
    try {
      const result = await call('/appointments/hold', {
        method: 'POST',
        body: { doctorId, startsAt },
      });
      setHold(result);
      setSymptomsSubmitted(false);
    } catch (err) {
      setError(err.message);
      refetchSlots();
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setError('');
    try {
      await call(`/appointments/${hold.appointmentId}/confirm`, { method: 'POST' });
      notify('Appointment confirmed.', 'success');
      navigate('/appointments');
    } catch (err) {
      setError(err.message);
      if (err.code === 'HOLD_EXPIRED') {
        setHold(null);
        setHoldExpiredNotice(true);
        refetchSlots();
      } else if (err.code === 'SYMPTOMS_REQUIRED') {
        setSymptomsSubmitted(false);
      }
    } finally {
      setConfirming(false);
    }
  }

  function handleHoldExpire() {
    setHold(null);
    setSymptomsSubmitted(false);
    setHoldExpiredNotice(true);
    refetchSlots();
  }

  const daySlots = slotsByDay[selectedDate] || [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl">{doctor ? `Book with ${doctor.fullName}` : 'Book an appointment'}</h1>
      {doctor && <p className="mb-6 text-sm text-ink/60">{doctor.specialisation}</p>}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {dateOptions.map((date) => {
          const iso = toISODate(date);
          const isSelected = iso === selectedDate;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelectedDate(iso)}
              className={`flex shrink-0 flex-col items-center rounded-[var(--radius-card)] border px-4 py-2 transition-colors ${
                isSelected ? 'border-primary bg-primary text-white' : 'border-line hover:border-primary'
              }`}
            >
              <span className="text-xs uppercase">{date.toLocaleDateString([], { weekday: 'short' })}</span>
              <span className="font-data text-lg">{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      {!hold && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink/70">Available times</h2>
          {loadingSlots ? (
            <p className="text-sm text-ink/60">Loading slots...</p>
          ) : (
            <SlotRail slots={daySlots} selected={null} onSelect={handleSelectSlot} />
          )}
          {holdExpiredNotice && (
            <p className="mt-4 text-sm text-caution">Hold expired - pick another slot.</p>
          )}
          {error && <p className="mt-4 text-sm text-urgent">{error}</p>}
        </section>
      )}

      {hold && (
        <section className="rounded-[var(--radius-card)] border border-primary bg-primary-50 p-5">
          <p className="font-data text-sm">
            <time dateTime={hold.startsAt}>
              {new Date(hold.startsAt).toLocaleString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </p>
          <p className="mt-1">
            <HoldCountdown expiresAt={hold.holdExpiresAt} onExpire={handleHoldExpire} />
          </p>

          {symptomsSubmitted ? (
            <p className="mt-4 text-sm text-primary">Symptom form submitted.</p>
          ) : (
            <div className="mt-4 border-t border-primary/20 pt-4">
              <SymptomForm
                appointmentId={hold.appointmentId}
                onSubmitted={() => setSymptomsSubmitted(true)}
              />
            </div>
          )}

          {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || !symptomsSubmitted}
              title={symptomsSubmitted ? undefined : 'Submit the symptom form to enable confirming'}
              className="rounded-[var(--radius-card)] bg-primary px-5 py-2 text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {confirming ? 'Confirming...' : 'Confirm appointment'}
            </button>
            <button
              type="button"
              onClick={() => {
                setHold(null);
                setSymptomsSubmitted(false);
                refetchSlots();
              }}
              className="rounded-[var(--radius-card)] border border-line px-5 py-2 hover:border-primary hover:text-primary"
            >
              Choose a different slot
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
