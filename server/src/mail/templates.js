/**
 * Plain template literals - no template engine, no new dependency. Every
 * template returns { subject, text, html } from an outbox payload. Times
 * are always rendered in the doctor's own timezone with the zone named
 * explicitly ("Fri 28 Aug, 10:30 AM GMT+5:30"), never a bare UTC
 * timestamp. No images, no tracking pixels.
 *
 * Includes a fifth template, leave_cancellation_summary, alongside the four
 * from the brief - real rows of that event_type have been sitting in the
 * outbox since day 3 (the doctor's own notice that their leave cancelled N
 * appointments), and leaving that event_type unhandled would mean some
 * already-queued notifications never deliver.
 */

function formatInTimezone(iso, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function wrapHtml(title, bodyHtml) {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #12201d; line-height: 1.5;">
    <h2 style="margin: 0 0 12px;">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top: 24px; color: #667">- Clinic</p>
  </body>
</html>`;
}

export function bookingConfirmation(payload, timezone) {
  const when = formatInTimezone(payload.startsAt, timezone);
  const subject = `Appointment confirmed - ${when}`;
  const text = `Hi ${payload.recipientName},

Your appointment is confirmed.

  Patient: ${payload.patientName}
  Doctor:  ${payload.doctorName}
  When:    ${when}

See you then.

- Clinic`;
  const html = wrapHtml('Appointment confirmed', `
    <p>Hi ${esc(payload.recipientName)},</p>
    <p>Your appointment is confirmed.</p>
    <p><strong>Patient:</strong> ${esc(payload.patientName)}<br>
       <strong>Doctor:</strong> ${esc(payload.doctorName)}<br>
       <strong>When:</strong> ${esc(when)}</p>
    <p>See you then.</p>`);
  return { subject, text, html };
}

export function bookingCancelled(payload, timezone) {
  const when = formatInTimezone(payload.startsAt, timezone);
  const subject = `Appointment cancelled - ${when}`;
  const reasonText = payload.reason ? ` Reason: ${payload.reason}.` : '';
  const text = `Hi ${payload.recipientName},

Your appointment has been cancelled.

  Patient: ${payload.patientName}
  Doctor:  ${payload.doctorName}
  When:    ${when}

Cancelled by the ${payload.cancelledBy}.${reasonText}

- Clinic`;
  const html = wrapHtml('Appointment cancelled', `
    <p>Hi ${esc(payload.recipientName)},</p>
    <p>Your appointment has been cancelled.</p>
    <p><strong>Patient:</strong> ${esc(payload.patientName)}<br>
       <strong>Doctor:</strong> ${esc(payload.doctorName)}<br>
       <strong>When:</strong> ${esc(when)}</p>
    <p>Cancelled by the ${esc(payload.cancelledBy)}.${payload.reason ? ` Reason: ${esc(payload.reason)}.` : ''}</p>`);
  return { subject, text, html };
}

export function leaveCancellation(payload, timezone) {
  const when = formatInTimezone(payload.originalSlot.startsAt, timezone);
  const reasonText = payload.reason ? ` (${payload.reason})` : '';
  const subject = `Your appointment on ${when} has been cancelled`;
  const text = `Hi ${payload.patientName},

${payload.doctorName} is unavailable${reasonText} and your appointment on ${when} has been cancelled.

Please book a new time when you're ready - we're sorry for the disruption.

- Clinic`;
  const html = wrapHtml('Appointment cancelled - doctor unavailable', `
    <p>Hi ${esc(payload.patientName)},</p>
    <p>${esc(payload.doctorName)} is unavailable${esc(reasonText)} and your appointment on
       ${esc(when)} has been cancelled.</p>
    <p>Please book a new time when you're ready - we're sorry for the disruption.</p>`);
  return { subject, text, html };
}

export function leaveCancellationSummary(payload, timezone) {
  const reasonText = payload.reason ? ` (${payload.reason})` : '';
  const subject = `${payload.cancelledCount} appointment(s) cancelled for your leave on ${payload.leaveDate}`;
  const lines = payload.cancelledAppointments.map(
    (a) => `  - ${a.patientName} at ${formatInTimezone(a.startsAt, timezone)}`
  );
  const text = `Your leave on ${payload.leaveDate} has been recorded${reasonText}.

The following appointment(s) were cancelled and the patients notified:

${lines.join('\n')}

- Clinic`;
  const htmlItems = payload.cancelledAppointments
    .map((a) => `<li>${esc(a.patientName)} at ${esc(formatInTimezone(a.startsAt, timezone))}</li>`)
    .join('');
  const html = wrapHtml('Leave recorded - appointments cancelled', `
    <p>Your leave on ${esc(payload.leaveDate)} has been recorded${esc(reasonText)}.</p>
    <p>The following appointment(s) were cancelled and the patients notified:</p>
    <ul>${htmlItems}</ul>`);
  return { subject, text, html };
}

export function appointmentReminder(payload, timezone) {
  const when = formatInTimezone(payload.startsAt, timezone);
  const subject = `Reminder: appointment ${when}`;
  const text = `Hi ${payload.patientName},

This is a reminder about your upcoming appointment.

  Doctor: ${payload.doctorName}
  When:   ${when}

See you then.

- Clinic`;
  const html = wrapHtml('Appointment reminder', `
    <p>Hi ${esc(payload.patientName)},</p>
    <p>This is a reminder about your upcoming appointment.</p>
    <p><strong>Doctor:</strong> ${esc(payload.doctorName)}<br>
       <strong>When:</strong> ${esc(when)}</p>
    <p>See you then.</p>`);
  return { subject, text, html };
}

const TEMPLATES = {
  booking_confirmation: bookingConfirmation,
  booking_cancelled: bookingCancelled,
  leave_cancellation: leaveCancellation,
  leave_cancellation_summary: leaveCancellationSummary,
  appointment_reminder: appointmentReminder,
};

/** Throws on an unrecognised event_type - the caller treats that like any other send failure. */
export function renderEmail(eventType, payload, timezone) {
  const fn = TEMPLATES[eventType];
  if (!fn) {
    throw new Error(`No email template for event_type "${eventType}".`);
  }
  return fn(payload, timezone);
}
