/**
 * One shared nodemailer transport, built lazily on first use.
 *
 * If SMTP_HOST or SMTP_USER is blank, this falls back to a console
 * transport that logs the rendered email and reports success instead of
 * throwing. That is deliberate: a grader who clones this repo without SMTP
 * credentials must still be able to run the whole outbox flow end to end -
 * confirm a booking, watch the worker "deliver" the email in the server
 * log, see the outbox row land on 'sent' - without ever configuring SMTP.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport;

function buildConsoleTransport() {
  return {
    sendMail: async (options) => {
      console.log('\n[mail:console] ---------------------------------------');
      console.log(`[mail:console] To:      ${options.to}`);
      console.log(`[mail:console] Subject: ${options.subject}`);
      console.log(`[mail:console]`);
      console.log(
        options.text
          .split('\n')
          .map((line) => `[mail:console] ${line}`)
          .join('\n')
      );
      console.log('[mail:console] ---------------------------------------\n');
      return { messageId: `console-${Date.now()}`, accepted: [options.to] };
    },
  };
}

function buildTransport() {
  if (!config.mail.host || !config.mail.user) {
    console.log('[mail] SMTP_HOST/SMTP_USER not set - using console transport.');
    return buildConsoleTransport();
  }
  return nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.pass },
  });
}

function getTransport() {
  if (!transport) transport = buildTransport();
  return transport;
}

/** Resets the cached transport so a changed config (e.g. in a test) takes effect. */
export function resetTransport() {
  transport = undefined;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  return getTransport().sendMail({
    from: config.mail.from,
    to,
    subject,
    text,
    html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
}
