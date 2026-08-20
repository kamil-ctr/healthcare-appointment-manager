/**
 * Appends to appointment_events. Every call site passes the SAME client
 * used for the surrounding transaction - never a separate connection - so
 * an event row can never exist without the change it describes, and never
 * survive that change being rolled back.
 */
export async function logEvent(client, appointmentId, event, actor, detail = '') {
  await client.query(
    `INSERT INTO appointment_events (appointment_id, event, actor, detail)
     VALUES ($1, $2, $3, $4)`,
    [appointmentId, event, actor, detail]
  );
}

export const actor = {
  patient: (id) => `patient:${id}`,
  doctor: (id) => `doctor:${id}`,
  admin: (id) => `admin:${id}`,
  system: 'system',
};
