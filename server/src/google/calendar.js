/**
 * Google Calendar REST client, native fetch only - no googleapis package
 * (roughly 50 MB for what amounts to four HTTP calls).
 *
 * Design decision: a SEPARATE event is created on each participant's own
 * calendar, rather than one event with the other party added as an
 * attendee. calendar_events is already keyed (appointment_id, user_id) for
 * exactly this. Attendee invites would (a) send Google's own invitation
 * email to the other party regardless of our own notification design,
 * (b) hit permission problems on personal Gmail accounts that don't allow
 * adding attendees to events they don't own, and (c) couple the two
 * parties' calendar state together - one side disconnecting Google should
 * never affect the other side's event. Two independent events, two
 * independent lifecycles.
 */
export class GoogleCalendarError extends Error {
  constructor(status, body) {
    super(`Google Calendar API error (${status}): ${JSON.stringify(body).slice(0, 300)}`);
    this.name = 'GoogleCalendarError';
    this.status = status;
    this.body = body;
  }
}

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars';

async function callCalendarApi(method, path, accessToken, body) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // 404/410 are the caller's job to interpret (idempotent-delete / already-
  // gone-on-patch) - never raised as an error here.
  if (res.status === 404 || res.status === 410) {
    return { status: res.status, data: null };
  }
  if (res.status === 204) {
    return { status: res.status, data: null };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new GoogleCalendarError(res.status, data);
  return { status: res.status, data };
}

/** RFC3339 start/end with the doctor's own timeZone set explicitly, plus 24h/1h popup reminders. */
export function buildEventBody({ summary, description, startsAt, endsAt, timezone }) {
  return {
    summary,
    description: description || undefined,
    start: { dateTime: startsAt, timeZone: timezone },
    end: { dateTime: endsAt, timeZone: timezone },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };
}

export async function createEvent(accessToken, calendarId, eventBody) {
  const { status, data } = await callCalendarApi(
    'POST',
    `/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    eventBody
  );
  if (status === 404 || status === 410) {
    // Shouldn't happen on a create (no existing event id involved) - treat
    // as a real failure so it retries rather than silently doing nothing.
    throw new GoogleCalendarError(status, { message: 'unexpected 404/410 creating an event' });
  }
  return data; // { id, htmlLink, ... }
}

/** Returns { deleted: true } if the event no longer exists on Google's side (404/410). */
export async function patchEvent(accessToken, calendarId, eventId, eventBody) {
  const { status, data } = await callCalendarApi(
    'PATCH',
    `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    eventBody
  );
  if (status === 404 || status === 410) return { deleted: true };
  return { deleted: false, event: data };
}

/** Deletion is idempotent - 404/410 is reported the same as a fresh delete, never thrown. */
export async function deleteEvent(accessToken, calendarId, eventId) {
  const { status } = await callCalendarApi(
    'DELETE',
    `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken
  );
  return { alreadyGone: status === 404 || status === 410 };
}
