import nodemailer from "nodemailer";
import { waitlistConfirmationMail } from "./email-template";

/**
 * Outbound mail via Cloudflare Email Service's SMTP submission endpoint.
 *
 * Cloudflare only offers implicit TLS on 465 — no STARTTLS on 587, no port 25 —
 * and authenticates with the literal username `api_token` plus an API token
 * carrying "Email Sending: Edit".
 *
 * Everything here is best-effort by design. A signup must never fail because
 * the mail hop was slow or down: the address is already durably stored by the
 * time this runs, so a failure to send is logged and swallowed rather than
 * turned into an error the visitor sees.
 */

const HOST = "smtp.mx.cloudflare.net";
const PORT = 465;

const FROM_EMAIL = process.env.MAIL_FROM ?? "hello@openthalamus.dev";
const FROM_NAME = process.env.MAIL_FROM_NAME ?? "thalamus";
const REPLY_TO = process.env.MAIL_REPLY_TO ?? "";

export function mailConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_EMAIL_TOKEN);
}

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: true, // implicit TLS; Cloudflare does not offer STARTTLS here
    auth: { user: "api_token", pass: process.env.CLOUDFLARE_EMAIL_TOKEN ?? "" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Never throws. Returns whether the message was accepted for delivery. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured()) {
    console.info(`[email] not configured; would have sent "${mail.subject}" to ${mail.to}`);
    return false;
  }
  try {
    await getTransport().sendMail({
      from: { address: FROM_EMAIL, name: FROM_NAME },
      to: mail.to,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function waitlistConfirmation(to: string): Mail {
  const { subject, text, html } = waitlistConfirmationMail();
  return { to, subject, text, html };
}
