-- =====================================================================
-- Healthcare Appointment & Follow-up Manager - PostgreSQL schema
-- ---------------------------------------------------------------------
-- Design notes:
--   * Concurrency rules are enforced by the DATABASE, not by application
--     code. See `unique_active_appointment` below.
--   * Every side effect that leaves the system (email, calendar) goes
--     through the `outbox` table so it can be retried after a failure.
--   * Runs top-to-bottom and is idempotent (safe to re-run).
-- Target: PostgreSQL 13+ (gen_random_uuid() is in core from 13 onwards)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. Identity & roles
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          text NOT NULL CHECK (role IN ('patient', 'doctor', 'admin')),
  email         text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  -- scrypt output, stored as: scrypt$N$r$p$<salt-hex>$<hash-hex>
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without needing the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Doctor profile, weekly availability, leave days
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialisation   text NOT NULL,
  qualification    text,
  consultation_fee numeric(10, 2) NOT NULL DEFAULT 0,
  slot_minutes     integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  bio              text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doctors_specialisation_idx ON doctors (lower(specialisation));

DROP TRIGGER IF EXISTS doctors_set_updated_at ON doctors;
CREATE TRIGGER doctors_set_updated_at BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Recurring weekly working hours. weekday: 0 = Sunday .. 6 = Saturday
-- (matches PostgreSQL EXTRACT(DOW) and JavaScript Date#getDay).
CREATE TABLE IF NOT EXISTS doctor_availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time   time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_time_order CHECK (end_time > start_time),
  CONSTRAINT availability_unique_block UNIQUE (doctor_id, weekday, start_time)
);

CREATE INDEX IF NOT EXISTS availability_doctor_weekday_idx
  ON doctor_availability (doctor_id, weekday);

-- A full-day leave. One row per doctor per date.
CREATE TABLE IF NOT EXISTS doctor_leave (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  leave_date date NOT NULL,
  reason     text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_unique_day UNIQUE (doctor_id, leave_date)
);

-- ---------------------------------------------------------------------
-- 3. Appointments  (the concurrency-critical table)
-- ---------------------------------------------------------------------
-- Lifecycle:
--   held --> confirmed --> completed
--     |          |
--     v          v
--  expired   cancelled_by_{patient,doctor,leave}
CREATE TABLE IF NOT EXISTS appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'held' CHECK (status IN (
                    'held', 'confirmed', 'completed',
                    'cancelled_by_patient', 'cancelled_by_doctor',
                    'cancelled_by_leave', 'expired'
                  )),
  -- Only meaningful while status = 'held'.
  hold_expires_at timestamptz,
  reason          text,          -- patient's short reason for visit
  cancel_reason   text,
  rescheduled_from uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_time_order CHECK (ends_at > starts_at),
  CONSTRAINT hold_requires_expiry CHECK (status <> 'held' OR hold_expires_at IS NOT NULL)
);

-- *** The single most important line in this schema. ***
-- Two concurrent requests for the same doctor + slot: exactly one INSERT
-- survives, the other gets a unique-violation (SQLSTATE 23505) which the
-- API maps to HTTP 409. Cancelled/expired rows are excluded from the
-- index, so a freed slot becomes bookable again immediately.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_appointment
  ON appointments (doctor_id, starts_at)
  WHERE status IN ('held', 'confirmed');

-- A patient should not sit in two places at once either.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_patient_slot
  ON appointments (patient_id, starts_at)
  WHERE status IN ('held', 'confirmed');

CREATE INDEX IF NOT EXISTS appointments_doctor_window_idx
  ON appointments (doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient_window_idx
  ON appointments (patient_id, starts_at DESC);
-- Drives the "expire stale holds" sweep.
CREATE INDEX IF NOT EXISTS appointments_expiring_holds_idx
  ON appointments (hold_expires_at)
  WHERE status = 'held';

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Clinical content
-- ---------------------------------------------------------------------
-- Filled by the patient during the hold window, before confirming.
CREATE TABLE IF NOT EXISTS symptom_forms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id      uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  symptoms            text NOT NULL,
  duration            text,
  severity            smallint CHECK (severity BETWEEN 1 AND 10),
  existing_conditions text,
  current_medications text,
  allergies           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Filled by the doctor after the visit.
CREATE TABLE IF NOT EXISTS visit_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  clinical_notes text NOT NULL,
  diagnosis      text,
  follow_up_date date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS visit_notes_set_updated_at ON visit_notes;
CREATE TRIGGER visit_notes_set_updated_at BEFORE UPDATE ON visit_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per prescribed medicine. `frequency_per_day` + `duration_days`
-- is what the reminder job expands into individual `reminders` rows.
CREATE TABLE IF NOT EXISTS prescriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  medication_name   text NOT NULL,
  dosage            text NOT NULL,
  frequency_per_day smallint NOT NULL CHECK (frequency_per_day BETWEEN 1 AND 6),
  duration_days     smallint NOT NULL CHECK (duration_days BETWEEN 1 AND 180),
  instructions      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prescriptions_appointment_idx
  ON prescriptions (appointment_id);

-- ---------------------------------------------------------------------
-- 5. LLM output  (stored, never regenerated on read)
-- ---------------------------------------------------------------------
-- status = 'failed' is a first-class outcome: the UI falls back to the
-- raw symptom form / clinical notes and offers a retry. A failure here
-- must never block booking or note submission.
CREATE TABLE IF NOT EXISTS ai_summaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('pre_visit', 'post_visit')),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'ready', 'failed')),
  urgency        text CHECK (urgency IN ('Low', 'Medium', 'High')),
  content        jsonb,          -- parsed, validated model output
  raw_response   text,           -- kept for debugging / prompt tuning
  model          text,
  prompt_version text,
  attempts       smallint NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_summary_per_kind UNIQUE (appointment_id, kind)
);

DROP TRIGGER IF EXISTS ai_summaries_set_updated_at ON ai_summaries;
CREATE TRIGGER ai_summaries_set_updated_at BEFORE UPDATE ON ai_summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Scheduling of future notifications
-- ---------------------------------------------------------------------
-- `reminders` = WHAT is due and WHEN (the schedule).
-- `outbox`    = HOW it gets delivered (the transport, with retries).
-- The background job reads due reminders and enqueues outbox rows.
CREATE TABLE IF NOT EXISTS reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  prescription_id uuid REFERENCES prescriptions(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN (
                    'appointment_reminder', 'medication_reminder', 'follow_up'
                  )),
  due_at          timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'queued', 'sent', 'cancelled')),
  queued_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The job's hot path: "everything scheduled and now due".
CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (due_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS reminders_appointment_idx ON reminders (appointment_id);

-- ---------------------------------------------------------------------
-- 7. Transactional outbox  (email + calendar delivery with retries)
-- ---------------------------------------------------------------------
-- Rows are inserted in the SAME transaction as the business change, so a
-- confirmed booking can never exist without its pending notification, and
-- a failed SMTP/Google call can never roll back a booking.
CREATE TABLE IF NOT EXISTS outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          text NOT NULL CHECK (topic IN ('email', 'calendar')),
  event_type     text NOT NULL,   -- e.g. booking_confirmed, leave_cancellation
  appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
  recipient_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts       smallint NOT NULL DEFAULT 0,
  max_attempts   smallint NOT NULL DEFAULT 5,
  next_retry_at  timestamptz NOT NULL DEFAULT now(),
  locked_at      timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);

-- The worker's claim query: pending + due, ordered by next_retry_at,
-- taken with FOR UPDATE SKIP LOCKED so two workers never collide.
CREATE INDEX IF NOT EXISTS outbox_claim_idx
  ON outbox (next_retry_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS outbox_appointment_idx ON outbox (appointment_id);

-- ---------------------------------------------------------------------
-- 8. Google Calendar integration
-- ---------------------------------------------------------------------
-- OAuth credentials live here, NEVER on `users`. A patient or doctor can
-- disconnect (revoked_at) without affecting their login.
CREATE TABLE IF NOT EXISTS google_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_sub    text,            -- stable Google account identifier
  google_email  text,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  scope         text,
  calendar_id   text NOT NULL DEFAULT 'primary',
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS google_accounts_set_updated_at ON google_accounts;
CREATE TRIGGER google_accounts_set_updated_at BEFORE UPDATE ON google_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maps our appointment to the Google event id on EACH side, which is what
-- makes update-on-reschedule and delete-on-cancel possible.
CREATE TABLE IF NOT EXISTS calendar_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id  text NOT NULL,
  calendar_id      text NOT NULL DEFAULT 'primary',
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_event_per_user_per_appointment UNIQUE (appointment_id, user_id)
);

DROP TRIGGER IF EXISTS calendar_events_set_updated_at ON calendar_events;
CREATE TRIGGER calendar_events_set_updated_at BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
