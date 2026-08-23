/**
 * Idempotent demo seed for a grader (or anyone) clicking around a fresh
 * deploy. Safe to re-run: if the demo dataset's admin user already exists,
 * the whole script is a no-op that reports the current counts and exits 0.
 *
 *   ALLOW_DEMO_SEED=true node --env-file=.env scripts/seed-demo.js
 *
 * Refuses to run at all without ALLOW_DEMO_SEED=true, so it can never fire
 * by accident against a real deployment that happens to share this
 * database.
 *
 * OUTBOX CHOICE: seeded appointments are inserted directly via SQL, NOT
 * through services/appointments.js's hold/confirm/cancel functions - those
 * functions insert outbox rows in the same transaction as the business
 * change (by design, see docs/system-design.md §4), and there is no
 * "insert already 'sent'" mode for them. Rather than fabricate outbox
 * history nobody asked to see (or worse, let the real worker try to email
 * fictitious addresses), this script SKIPS outbox/reminder enqueueing
 * entirely for every seeded row. A grader clicking around a demo account
 * must not trigger a wave of real emails on the next job tick.
 *
 * The pre-visit and post-visit LLM summaries are seeded as static, already
 * 'ready' content (not a live model call) - reproducible without network
 * access or an LLM_API_KEY, and instant to run in CI or against Neon.
 *
 * All seeded accounts share one domain (@clinicdemo.local) - a reserved,
 * non-resolving TLD, so a misconfigured SMTP setup can never bounce real
 * mail at a real registrant. Doctor/patient/admin passwords are
 * deliberately distinct from each other (see ADMIN_PASSWORD/DOCTOR_PASSWORD/
 * PATIENT_PASSWORD below) rather than one password shared by every role.
 */
import { pool, one, closePool } from '../src/db/pool.js';
import { hashPassword } from '../src/lib/password.js';
import { PROMPT_VERSION, POST_VISIT_PROMPT_VERSION } from '../src/llm/prompts.js';
import { logEvent, actor } from '../src/services/events.js';

const DEMO_DOMAIN = 'clinicdemo.local';
const ADMIN_PASSWORD = 'ClinicOps#2026';
const DOCTOR_PASSWORD = 'RoundsAt9!';
const PATIENT_PASSWORD = 'WaitingRoom7';

// weekday: 0 = Sunday .. 6 = Saturday (matches doctor_availability's convention).
const DOCTORS = [
  {
    email: `iram.khan@${DEMO_DOMAIN}`,
    fullName: 'Dr. Iram Khan',
    specialisation: 'General Medicine',
    qualification: 'MBBS, MD - General Medicine',
    bio: 'General physician focused on preventive care, diabetes, and hypertension management for adult patients.',
    consultationFee: 650,
    slotMinutes: 20,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '14:00' })),
  },
  {
    email: `manas.awasthi@${DEMO_DOMAIN}`,
    fullName: 'Dr. Manas Awasthi',
    specialisation: 'General Medicine',
    qualification: 'MBBS, MD - General Medicine',
    bio: 'Runs an evening general medicine clinic for working professionals, with a special interest in lifestyle disease management.',
    consultationFee: 720,
    slotMinutes: 20,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '16:00', end: '20:00' })),
  },
  {
    email: `divyanshu.sharma@${DEMO_DOMAIN}`,
    fullName: 'Dr. Divyanshu Sharma',
    specialisation: 'Cardiology',
    qualification: 'MBBS, MD, DM - Cardiology',
    bio: 'Interventional cardiologist with a decade of experience in coronary artery disease and hypertension management.',
    consultationFee: 1350,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '13:00' })),
  },
  {
    email: `aerin.patel@${DEMO_DOMAIN}`,
    fullName: 'Dr. Aerin Patel',
    specialisation: 'Cardiology',
    qualification: 'MBBS, MD, DM - Cardiology',
    bio: 'Cardiologist specialising in preventive cardiology and post-cardiac-event rehabilitation.',
    consultationFee: 1180,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [2, 3, 4, 6].map((weekday) => ({ weekday, start: '11:00', end: '16:00' })),
  },
  {
    email: `palak.khurana@${DEMO_DOMAIN}`,
    fullName: 'Dr. Palak Khurana',
    specialisation: 'Dermatology',
    qualification: 'MBBS, MD - Dermatology, Venereology & Leprosy',
    bio: 'Dermatologist treating acne, pigmentation, and hair loss, with a focus on cosmetic dermatology.',
    consultationFee: 870,
    slotMinutes: 20,
    timezone: 'Asia/Kolkata',
    availability: [1, 3, 5].map((weekday) => ({ weekday, start: '10:00', end: '14:00' })),
    leaveNextWeek: true,
  },
  {
    email: `sahil.sahani@${DEMO_DOMAIN}`,
    fullName: 'Dr. Sahil Sahani',
    specialisation: 'Dermatology',
    qualification: 'MBBS, MD - Dermatology, Venereology & Leprosy',
    bio: 'Evening and weekend dermatology clinic covering eczema, psoriasis, and skin infections.',
    consultationFee: 820,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [2, 4, 6].map((weekday) => ({ weekday, start: '15:00', end: '19:00' })),
  },
  {
    email: `ayushi.sharma@${DEMO_DOMAIN}`,
    fullName: 'Dr. Ayushi Sharma',
    specialisation: 'Pediatrics',
    qualification: 'MBBS, MD - Pediatrics',
    bio: 'Pediatrician focused on newborn care, vaccination schedules, and childhood nutrition.',
    consultationFee: 750,
    slotMinutes: 20,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
  },
  {
    email: `ojas.patil@${DEMO_DOMAIN}`,
    fullName: 'Dr. Ojas Patil',
    specialisation: 'Pediatrics',
    qualification: 'MBBS, MD - Pediatrics',
    bio: 'Runs an after-school pediatric clinic for common childhood illnesses and growth monitoring.',
    consultationFee: 680,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '16:00', end: '19:00' })),
  },
  {
    email: `abhishek.yadav@${DEMO_DOMAIN}`,
    fullName: 'Dr. Abhishek Yadav',
    specialisation: 'Orthopedics',
    qualification: 'MBBS, MS - Orthopedics',
    bio: 'Orthopedic surgeon specialising in sports injuries and joint replacement, splits time between clinic and OT.',
    consultationFee: 1050,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [1, 3, 5].flatMap((weekday) => [
      { weekday, start: '09:00', end: '13:00' },
      { weekday, start: '17:00', end: '19:00' },
    ]),
  },
  {
    email: `kshitiz.joharwal@${DEMO_DOMAIN}`,
    fullName: 'Dr. Kshitiz Joharwal',
    specialisation: 'Orthopedics',
    qualification: 'MBBS, MS - Orthopedics',
    bio: 'Orthopedic consultant for spine and fracture care, sees patients for detailed follow-up consultations.',
    consultationFee: 980,
    slotMinutes: 45,
    timezone: 'Asia/Kolkata',
    availability: [2, 4, 6].map((weekday) => ({ weekday, start: '10:00', end: '14:30' })),
  },
  {
    email: `srajal.jain@${DEMO_DOMAIN}`,
    fullName: 'Dr. Srajal Jain',
    specialisation: 'Gynecology',
    qualification: 'MBBS, MD, DGO - Obstetrics & Gynecology',
    bio: 'Obstetrician-gynecologist providing antenatal care, family planning, and routine gynecological checkups.',
    consultationFee: 1120,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '10:00', end: '13:00' })),
  },
  {
    email: `tanay.singh@${DEMO_DOMAIN}`,
    fullName: 'Dr. Tanay Singh',
    specialisation: 'Gynecology',
    qualification: 'MBBS, MD, DGO - Obstetrics & Gynecology',
    bio: 'Gynecologist with a weekend clinic focused on PCOS management and adolescent gynecology.',
    consultationFee: 890,
    slotMinutes: 30,
    timezone: 'Asia/Kolkata',
    availability: [3, 5, 6].map((weekday) => ({ weekday, start: '14:00', end: '18:00' })),
  },
  {
    email: `hammad.khan@${DEMO_DOMAIN}`,
    fullName: 'Dr. Hammad Khan',
    specialisation: 'Psychiatry',
    qualification: 'MBBS, MD - Psychiatry',
    bio: 'Psychiatrist specialising in anxiety, depression, and stress-related disorders, with longer sessions for thorough evaluation.',
    consultationFee: 1450,
    slotMinutes: 45,
    timezone: 'Asia/Kolkata',
    availability: [1, 2, 3, 4].map((weekday) => ({ weekday, start: '11:00', end: '15:30' })),
  },
];

const PATIENTS = [
  { email: `aisha.rahman@${DEMO_DOMAIN}`, fullName: 'Aisha Rahman' },
  { email: `karan.gupta@${DEMO_DOMAIN}`, fullName: 'Karan Gupta' },
  { email: `neha.iyer@${DEMO_DOMAIN}`, fullName: 'Neha Iyer' },
];

const ADMIN_EMAIL = `admin@${DEMO_DOMAIN}`;

/** Next date (from today + startOffsetDays) whose weekday is in `weekdays`, walking forward day by day. */
function nextAvailableWeekday(startOffsetDays, weekdays) {
  let d = new Date(Date.now() + startOffsetDays * 86400000);
  while (!weekdays.includes(d.getUTCDay())) {
    d = new Date(d.getTime() + 86400000);
  }
  return d;
}

function weekdaysOf(doctor) {
  return [...new Set(doctor.availability.map((a) => a.weekday))];
}

/** Builds a UTC instant for `hhmm` local time in `timezone` on `dateAnchor`'s calendar date - computed in Postgres, not JS Date math, for correctness. */
async function localInstant(dateAnchor, hhmm, timezone) {
  const dateStr = dateAnchor.toISOString().slice(0, 10);
  const row = await one(`SELECT (($1::date + $2::time)::timestamp AT TIME ZONE $3) AS "instant"`, [
    dateStr,
    hhmm,
    timezone,
  ]);
  return row.instant;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

async function withTx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function findOrCreateUser(client, { role, email, fullName, passwordHash }) {
  const existing = await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await client.query(
    `INSERT INTO users (role, email, full_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [role, email, fullName, passwordHash]
  );
  return rows[0].id;
}

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error('[seed-demo] refusing to run: set ALLOW_DEMO_SEED=true to confirm.');
    process.exitCode = 1;
    return;
  }

  const already = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [ADMIN_EMAIL]);
  if (already) {
    const counts = await one(
      `SELECT
         (SELECT count(*)::int FROM users WHERE role = 'doctor' AND email LIKE '%@${DEMO_DOMAIN}') AS doctors,
         (SELECT count(*)::int FROM users WHERE role = 'patient' AND email LIKE '%@${DEMO_DOMAIN}') AS patients,
         (SELECT count(*)::int FROM appointments a JOIN doctors d ON d.user_id = a.doctor_id
            JOIN users u ON u.id = d.user_id WHERE u.email LIKE '%@${DEMO_DOMAIN}') AS appointments`
    );
    console.log('[seed-demo] demo data already present - no-op.');
    console.log(
      `[seed-demo] doctors=${counts.doctors} patients=${counts.patients} appointments=${counts.appointments}`
    );
    return;
  }

  const adminPasswordHash = await hashPassword(ADMIN_PASSWORD);
  const doctorPasswordHash = await hashPassword(DOCTOR_PASSWORD);
  const patientPasswordHash = await hashPassword(PATIENT_PASSWORD);

  console.log('[seed-demo] creating admin...');
  const adminId = await withTx((c) =>
    findOrCreateUser(c, { role: 'admin', email: ADMIN_EMAIL, fullName: 'Demo Admin', passwordHash: adminPasswordHash })
  );

  console.log(`[seed-demo] creating ${DOCTORS.length} doctors with availability...`);
  const doctorIds = [];
  for (const doc of DOCTORS) {
    const userId = await withTx(async (c) => {
      const id = await findOrCreateUser(c, {
        role: 'doctor',
        email: doc.email,
        fullName: doc.fullName,
        passwordHash: doctorPasswordHash,
      });
      await c.query(
        `INSERT INTO doctors (user_id, specialisation, qualification, consultation_fee, slot_minutes, timezone, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO NOTHING`,
        [id, doc.specialisation, doc.qualification, doc.consultationFee, doc.slotMinutes, doc.timezone, doc.bio]
      );
      for (const block of doc.availability) {
        await c.query(
          `INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (doctor_id, weekday, start_time) DO NOTHING`,
          [id, block.weekday, block.start, block.end]
        );
      }
      if (doc.leaveNextWeek) {
        const leaveDate = nextAvailableWeekday(7, weekdaysOf(doc)).toISOString().slice(0, 10);
        await c.query(
          `INSERT INTO doctor_leave (doctor_id, leave_date, reason, created_by)
           VALUES ($1, $2, 'Conference', $3)
           ON CONFLICT (doctor_id, leave_date) DO NOTHING`,
          [id, leaveDate, adminId]
        );
        console.log(`[seed-demo]   ${doc.fullName}: leave day on ${leaveDate}`);
      }
      return id;
    });
    doctorIds.push({ ...doc, id: userId });
  }

  console.log(`[seed-demo] creating ${PATIENTS.length} patients...`);
  const patientIds = [];
  for (const p of PATIENTS) {
    const id = await withTx((c) =>
      findOrCreateUser(c, { role: 'patient', email: p.email, fullName: p.fullName, passwordHash: patientPasswordHash })
    );
    patientIds.push({ ...p, id });
  }

  const byName = (name) => doctorIds.find((d) => d.fullName === name);
  const drGeneral = byName('Dr. Iram Khan');
  const drCardio = byName('Dr. Divyanshu Sharma');
  const drPeds = byName('Dr. Ayushi Sharma');
  const drDerm = byName('Dr. Palak Khurana');
  const [pAisha, pKaran, pNeha] = patientIds;

  console.log('[seed-demo] seeding appointment #1: confirmed upcoming, symptom form + READY pre-visit summary...');
  await withTx(async (c) => {
    const day = nextAvailableWeekday(1, weekdaysOf(drGeneral));
    const startsAt = await localInstant(day, '10:00', drGeneral.timezone);
    const endsAt = await localInstant(day, addMinutes('10:00', drGeneral.slotMinutes), drGeneral.timezone);
    const { rows } = await c.query(
      `INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id`,
      [drGeneral.id, pAisha.id, startsAt, endsAt]
    );
    const apptId = rows[0].id;
    await c.query(
      `INSERT INTO symptom_forms (appointment_id, symptoms, duration, severity, existing_conditions, current_medications, allergies)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        apptId,
        'Persistent headache and mild fever for two days, worse in the evening.',
        '2 days',
        5,
        'None',
        'None',
        'None known',
      ]
    );
    const content = {
      urgency: 'Medium',
      chiefComplaint: 'Headache and low-grade fever for 2 days, worsening in the evenings',
      symptomTimeline: 'Headache and low-grade fever, 5/10 severity, present 2 days, worse in the evenings',
      relevantHistory: 'No relevant history reported - no existing conditions, medications, or allergies.',
      possibleConcernAreas: ['possible infection', 'neurological'],
      suggestedQuestions: [
        'Is the fever accompanied by neck stiffness or light sensitivity?',
        'Any recent travel, sick contacts, or missed vaccinations?',
        'Has the patient tried any medication, and did it help?',
      ],
    };
    await c.query(
      `INSERT INTO ai_summaries (appointment_id, kind, status, urgency, content, raw_response, model, prompt_version, attempts)
       VALUES ($1, 'pre_visit', 'ready', $2, $3::jsonb, $3::text, 'seed-demo (static)', $4, 1)`,
      [apptId, content.urgency, JSON.stringify(content), PROMPT_VERSION]
    );
    await logEvent(c, apptId, 'held', actor.patient(pAisha.id), 'seed-demo');
    await logEvent(c, apptId, 'symptoms_submitted', actor.patient(pAisha.id), 'seed-demo');
    await logEvent(c, apptId, 'confirmed', actor.patient(pAisha.id), 'seed-demo');
    await logEvent(c, apptId, 'summary_ready', actor.system, `urgency=${content.urgency} (seed-demo, static)`);
  });

  console.log('[seed-demo] seeding appointment #2: completed, notes + prescription + READY post-visit summary...');
  await withTx(async (c) => {
    const day = nextAvailableWeekday(-3, weekdaysOf(drCardio)); // a past weekday
    const startsAt = await localInstant(day, '11:00', drCardio.timezone);
    const endsAt = await localInstant(day, addMinutes('11:00', drCardio.slotMinutes), drCardio.timezone);
    const { rows } = await c.query(
      `INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'completed') RETURNING id`,
      [drCardio.id, pKaran.id, startsAt, endsAt]
    );
    const apptId = rows[0].id;
    await c.query(
      `INSERT INTO symptom_forms (appointment_id, symptoms, duration, severity)
       VALUES ($1, 'Occasional chest tightness on exertion.', '1 week', 4)`,
      [apptId]
    );
    await c.query(
      `INSERT INTO visit_notes (appointment_id, doctor_id, clinical_notes, diagnosis, follow_up_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        apptId,
        drCardio.id,
        'Mild exertional chest tightness, ECG normal, likely musculoskeletal. Advised rest and follow-up if symptoms persist.',
        'Non-cardiac chest pain (musculoskeletal)',
        nextAvailableWeekday(21, [1, 2, 3, 4, 5]).toISOString().slice(0, 10),
      ]
    );
    const { rows: presRows } = await c.query(
      `INSERT INTO prescriptions (appointment_id, medication_name, dosage, frequency_per_day, duration_days, instructions)
       VALUES ($1, 'Ibuprofen', '400mg', 2, 5, 'Take after food')
       RETURNING medication_name AS "medicationName"`,
      [apptId]
    );
    const content = {
      summary:
        'Your chest tightness looks like it is coming from your chest muscles, not your heart - your heart tracing (ECG) was normal. Rest and the anti-inflammatory medicine below should help.',
      medicationSchedule: [
        { medication: presRows[0].medicationName, dose: '400mg', when: 'Twice a day, after food', duration: '5 days' },
      ],
      followUpSteps: ['Rest from strenuous activity for the next few days.', 'Come back if the tightness returns or gets worse.'],
      whenToSeekHelp: [
        'Sudden severe chest pain, shortness of breath, or pain spreading to your arm or jaw - seek emergency care immediately.',
      ],
    };
    await c.query(
      `INSERT INTO ai_summaries (appointment_id, kind, status, content, raw_response, model, prompt_version, attempts)
       VALUES ($1, 'post_visit', 'ready', $2::jsonb, $2::text, 'seed-demo (static)', $3, 1)`,
      [apptId, JSON.stringify(content), POST_VISIT_PROMPT_VERSION]
    );
    await logEvent(c, apptId, 'held', actor.patient(pKaran.id), 'seed-demo');
    await logEvent(c, apptId, 'symptoms_submitted', actor.patient(pKaran.id), 'seed-demo');
    await logEvent(c, apptId, 'confirmed', actor.patient(pKaran.id), 'seed-demo');
    await logEvent(c, apptId, 'notes_submitted', actor.doctor(drCardio.id), 'seed-demo');
    await logEvent(c, apptId, 'completed', actor.doctor(drCardio.id), 'seed-demo');
    await logEvent(c, apptId, 'post_visit_summary_ready', actor.system, 'seed-demo, static');
  });

  console.log('[seed-demo] seeding appointment #3: cancelled...');
  await withTx(async (c) => {
    const day = nextAvailableWeekday(2, weekdaysOf(drPeds));
    const startsAt = await localInstant(day, '11:15', drPeds.timezone);
    const endsAt = await localInstant(day, addMinutes('11:15', drPeds.slotMinutes), drPeds.timezone);
    const { rows } = await c.query(
      `INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status, cancel_reason)
       VALUES ($1, $2, $3, $4, 'cancelled_by_patient', 'Schedule conflict')
       RETURNING id`,
      [drPeds.id, pNeha.id, startsAt, endsAt]
    );
    await logEvent(c, rows[0].id, 'held', actor.patient(pNeha.id), 'seed-demo');
    await logEvent(c, rows[0].id, 'cancelled_by_patient', actor.patient(pNeha.id), 'Schedule conflict (seed-demo)');
  });

  console.log('[seed-demo] seeding appointment #4: expired hold...');
  await withTx(async (c) => {
    const day = nextAvailableWeekday(3, weekdaysOf(drDerm));
    const startsAt = await localInstant(day, '13:00', drDerm.timezone);
    const endsAt = await localInstant(day, addMinutes('13:00', drDerm.slotMinutes), drDerm.timezone);
    const { rows } = await c.query(
      `INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status, hold_expires_at)
       VALUES ($1, $2, $3, $4, 'expired', now() - interval '1 day')
       RETURNING id`,
      [drDerm.id, pAisha.id, startsAt, endsAt]
    );
    await logEvent(c, rows[0].id, 'held', actor.patient(pAisha.id), 'seed-demo');
    await logEvent(c, rows[0].id, 'expired', actor.system, 'seed-demo (never confirmed)');
  });

  console.log('\n[seed-demo] done. Demo credentials:');
  console.log(`[seed-demo]   admin:    ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log(`[seed-demo]   doctor password (shared across all doctor accounts): ${DOCTOR_PASSWORD}`);
  for (const d of DOCTORS) {
    console.log(`[seed-demo]   doctor:   ${d.email}  (${d.specialisation}, ₹${d.consultationFee}, ${d.slotMinutes}min slots)`);
  }
  console.log(`[seed-demo]   patient password (shared across all patient accounts): ${PATIENT_PASSWORD}`);
  for (const p of PATIENTS) console.log(`[seed-demo]   patient:  ${p.email}`);
  console.log("[seed-demo] No outbox rows were enqueued for any seeded row - see this script's header comment for why.");
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error('[seed-demo] FAILED:', err.message);
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
