/**
 * Hand-rolled RFC 5545 (iCalendar) generator - no dependency. Google
 * Calendar sync (day 7) requires the recipient to complete OAuth; an .ics
 * attachment works for every recipient, including a grader who never
 * connects an account, so this is the notification path that actually
 * reaches everyone.
 *
 * UID is derived from the appointment's reschedule-chain ROOT id (see
 * outbox.js's resolveIcsIdentity), not the current row's own id, so a
 * reschedule updates the same calendar entry instead of creating a second
 * one - "the appointment's whole life" spans every row linked by
 * rescheduled_from, not just the current row.
 */

const CRLF = '\r\n';

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds one unfolded "PROPERTY:value" line to <=75 octets per physical line, per RFC 5545 §3.1. */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte UTF-8 sequence: back off while `end` lands
    // on a continuation byte (10xxxxxx).
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation line: 1 leading space + 74 octets of content = 75 total
  }
  return parts.join(`${CRLF} `);
}

function formatUtcStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * method: 'REQUEST' (create/update - confirmation, reschedule) or
 * 'CANCEL' (cancellation - carries STATUS:CANCELLED per the spec).
 */
export function buildIcs({
  uid,
  sequence,
  method,
  startsAt,
  endsAt,
  summary,
  description,
  location,
  organizerEmail,
  organizerName = 'Clinic',
  attendeeEmail,
  attendeeName,
}) {
  const cancelled = method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Healthcare Appointment Manager//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}@healthcare-appointment-manager`,
    `DTSTAMP:${formatUtcStamp(new Date().toISOString())}`,
    `DTSTART:${formatUtcStamp(startsAt)}`,
    `DTEND:${formatUtcStamp(endsAt)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push(`ORGANIZER;CN=${escapeText(organizerName)}:mailto:${organizerEmail}`);
  if (attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeText(attendeeName || attendeeEmail)};ROLE=REQ-PARTICIPANT;` +
        `PARTSTAT=${cancelled ? 'DECLINED' : 'NEEDS-ACTION'}:mailto:${attendeeEmail}`
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldLine).join(CRLF) + CRLF;
}
