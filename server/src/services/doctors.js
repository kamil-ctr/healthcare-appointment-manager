/**
 * Doctor CRUD, profile reads, and weekly availability - the transactional
 * logic behind server/src/routes/admin.js and server/src/routes/doctors.js.
 * Doctor leave (and its appointment-cancellation cascade) lives in
 * services/leave.js, not here.
 */
import { one, many, query, withTransaction } from '../db/pool.js';
import { badRequest, notFound, emailTaken } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';

const DOCTOR_COLUMNS = `
  u.id, u.full_name AS "fullName", u.email, u.phone, u.is_active AS "isActive",
  d.specialisation, d.qualification, d.consultation_fee AS "consultationFee",
  d.slot_minutes AS "slotMinutes", d.timezone
`;

export async function createDoctor({
  email,
  fullName,
  phone,
  password,
  specialisation,
  qualification,
  consultationFee,
  slotMinutes,
  timezone,
  bio,
}) {
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(async (client) => {
      const { rows: userRows } = await client.query(
        `INSERT INTO users (role, email, full_name, phone, password_hash)
         VALUES ('doctor', $1, $2, $3, $4)
         RETURNING id, email, full_name AS "fullName", phone, is_active AS "isActive"`,
        [email, fullName, phone ?? null, passwordHash]
      );
      const user = userRows[0];

      const { rows: doctorRows } = await client.query(
        `INSERT INTO doctors
           (user_id, specialisation, qualification, consultation_fee, slot_minutes, timezone, bio)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING specialisation, qualification, consultation_fee AS "consultationFee",
                   slot_minutes AS "slotMinutes", timezone, bio`,
        [
          user.id,
          specialisation,
          qualification ?? null,
          consultationFee ?? 0,
          slotMinutes ?? 30,
          timezone ?? 'Asia/Kolkata',
          bio ?? null,
        ]
      );

      return { ...user, ...doctorRows[0] };
    });
  } catch (err) {
    if (err.code === '23505') throw emailTaken();
    throw err;
  }
}

export async function listDoctors({ specialisation, q, includeInactive = false } = {}) {
  const conditions = [];
  const params = [];

  if (!includeInactive) conditions.push('u.is_active = true');

  if (specialisation) {
    params.push(specialisation);
    conditions.push(`lower(d.specialisation) = lower($${params.length})`);
  }

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(u.full_name ILIKE $${params.length} OR d.specialisation ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return many(
    `SELECT ${DOCTOR_COLUMNS}
       FROM doctors d JOIN users u ON u.id = d.user_id
       ${where}
       ORDER BY u.full_name`,
    params
  );
}

export async function getDoctorDetail(doctorId, { requireActive = false } = {}) {
  const conditions = ['d.user_id = $1'];
  if (requireActive) conditions.push('u.is_active = true');

  const profile = await one(
    `SELECT ${DOCTOR_COLUMNS}, d.bio, d.created_at AS "createdAt"
       FROM doctors d JOIN users u ON u.id = d.user_id
      WHERE ${conditions.join(' AND ')}`,
    [doctorId]
  );
  if (!profile) return null;

  const availability = await many(
    `SELECT weekday, to_char(start_time, 'HH24:MI') AS "startTime",
            to_char(end_time, 'HH24:MI') AS "endTime"
       FROM doctor_availability
      WHERE doctor_id = $1
      ORDER BY weekday, start_time`,
    [doctorId]
  );

  // to_char, not the bare column: node-postgres parses DATE with the local
  // (non-UTC) Date constructor, which silently shifts the value by a day
  // once JSON-serialized on any host whose local timezone isn't UTC.
  const upcomingLeave = await many(
    `SELECT to_char(leave_date, 'YYYY-MM-DD') AS "date", reason
       FROM doctor_leave
      WHERE doctor_id = $1 AND leave_date >= CURRENT_DATE
      ORDER BY leave_date`,
    [doctorId]
  );

  return { ...profile, availability, upcomingLeave };
}

const EDITABLE_USER_FIELDS = { fullName: 'full_name', phone: 'phone' };
const EDITABLE_DOCTOR_FIELDS = {
  specialisation: 'specialisation',
  qualification: 'qualification',
  consultationFee: 'consultation_fee',
  slotMinutes: 'slot_minutes',
  timezone: 'timezone',
  bio: 'bio',
};

/** email and role are deliberately absent from both maps - never editable here. */
export async function updateDoctorProfile(doctorId, patch) {
  const userSet = {};
  for (const [key, column] of Object.entries(EDITABLE_USER_FIELDS)) {
    if (patch[key] !== undefined) userSet[column] = patch[key];
  }
  const doctorSet = {};
  for (const [key, column] of Object.entries(EDITABLE_DOCTOR_FIELDS)) {
    if (patch[key] !== undefined) doctorSet[column] = patch[key];
  }

  if (Object.keys(userSet).length === 0 && Object.keys(doctorSet).length === 0) {
    throw badRequest('No editable fields provided.');
  }

  const existing = await one(`SELECT user_id FROM doctors WHERE user_id = $1`, [doctorId]);
  if (!existing) throw notFound('Doctor not found.');

  await withTransaction(async (client) => {
    if (Object.keys(userSet).length > 0) {
      const columns = Object.keys(userSet);
      const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
      await client.query(`UPDATE users SET ${setClause} WHERE id = $1 AND role = 'doctor'`, [
        doctorId,
        ...columns.map((col) => userSet[col]),
      ]);
    }
    if (Object.keys(doctorSet).length > 0) {
      const columns = Object.keys(doctorSet);
      const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
      await client.query(`UPDATE doctors SET ${setClause} WHERE user_id = $1`, [
        doctorId,
        ...columns.map((col) => doctorSet[col]),
      ]);
    }
  });

  return getDoctorDetail(doctorId);
}

/** Soft deactivate only - appointments reference this row, so it is never hard-deleted. */
export async function deactivateDoctor(doctorId) {
  const existing = await one(`SELECT user_id FROM doctors WHERE user_id = $1`, [doctorId]);
  if (!existing) return null;

  await query(`UPDATE users SET is_active = false WHERE id = $1 AND role = 'doctor'`, [doctorId]);

  const { rows } = await query(
    `SELECT count(*)::int AS n FROM appointments
      WHERE doctor_id = $1 AND status IN ('held', 'confirmed') AND starts_at > now()`,
    [doctorId]
  );

  return { futureActiveAppointments: rows[0].n };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeToMinutes(value) {
  const match = typeof value === 'string' ? TIME_RE.exec(value) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Replaces the doctor's entire weekly schedule in one transaction. Rejects
 * the whole payload (never applies part of it) if any block is malformed,
 * overlaps another block on the same weekday, or its duration isn't a whole
 * multiple of the doctor's slot length.
 */
export async function setDoctorAvailability(doctorId, blocks) {
  const doctor = await one(`SELECT slot_minutes AS "slotMinutes" FROM doctors WHERE user_id = $1`, [
    doctorId,
  ]);
  if (!doctor) throw notFound('Doctor not found.');

  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw badRequest('availability must be a non-empty array of { weekday, startTime, endTime }.');
  }

  const errors = [];
  const parsed = blocks.map((block, index) => {
    const weekday = Number(block?.weekday);
    const startMinutes = parseTimeToMinutes(block?.startTime);
    const endMinutes = parseTimeToMinutes(block?.endTime);

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      errors.push({ index, reason: 'weekday must be an integer 0-6' });
    }
    if (startMinutes === null) errors.push({ index, reason: 'startTime must be HH:MM' });
    if (endMinutes === null) errors.push({ index, reason: 'endTime must be HH:MM' });

    return { index, weekday, startMinutes, endMinutes, startTime: block?.startTime, endTime: block?.endTime };
  });

  for (const b of parsed) {
    if (b.startMinutes === null || b.endMinutes === null) continue;
    if (b.endMinutes <= b.startMinutes) {
      errors.push({ index: b.index, reason: 'endTime must be after startTime' });
      continue;
    }
    const duration = b.endMinutes - b.startMinutes;
    if (duration % doctor.slotMinutes !== 0) {
      errors.push({
        index: b.index,
        reason: `block duration must be a whole multiple of the doctor's slot length (${doctor.slotMinutes} minutes)`,
      });
    }
  }

  const byWeekday = new Map();
  for (const b of parsed) {
    if (b.startMinutes === null || b.endMinutes === null || !Number.isInteger(b.weekday)) continue;
    if (!byWeekday.has(b.weekday)) byWeekday.set(b.weekday, []);
    byWeekday.get(b.weekday).push(b);
  }
  for (const group of byWeekday.values()) {
    group.sort((a, c) => a.startMinutes - c.startMinutes);
    for (let i = 1; i < group.length; i += 1) {
      if (group[i].startMinutes < group[i - 1].endMinutes) {
        errors.push({ index: group[i].index, reason: `overlaps with block at index ${group[i - 1].index}` });
      }
    }
  }

  if (errors.length > 0) {
    throw badRequest('One or more availability blocks are invalid.', { blocks: errors });
  }

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM doctor_availability WHERE doctor_id = $1`, [doctorId]);
    for (const b of parsed) {
      await client.query(
        `INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [doctorId, b.weekday, b.startTime, b.endTime]
      );
    }
    const { rows } = await client.query(
      `SELECT weekday, to_char(start_time, 'HH24:MI') AS "startTime",
              to_char(end_time, 'HH24:MI') AS "endTime"
         FROM doctor_availability WHERE doctor_id = $1 ORDER BY weekday, start_time`,
      [doctorId]
    );
    return rows;
  });
}
