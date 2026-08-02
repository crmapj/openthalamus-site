import nodemailer from "nodemailer";

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

/**
 * Waitlist confirmation.
 *
 * Plain text is not optional: some clients only render it, and a missing text
 * part measurably worsens spam scoring. The HTML is deliberately simple —
 * inline styles, a table-free single column, no images, no web fonts, no
 * tracking pixel. Mail clients strip most CSS, and anything clever here reads
 * as marketing to a spam filter.
 */
export function waitlistConfirmation(to: string): Mail {
  const subject = "You're on the thalamus waitlist";

  const text = [
    "You're on the list.",
    "",
    "thalamus is the control plane and memory for agentic work — one memory, one",
    "trust gate, and durable jobs across swappable engines.",
    "",
    "We'll email you when there's a build worth self-hosting. Nothing else, and we",
    "won't share your address.",
    "",
    "If you didn't sign up, ignore this — the address is only used to send that one",
    "announcement.",
    "",
    "https://openthalamus.dev",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#0a0a0a;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#d5d5d5;font-size:15px;line-height:1.6;">
    <p style="margin:0 0 26px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#8a8a8a;">thalamus</p>
    <h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;letter-spacing:-0.02em;font-weight:600;color:#f2f2f2;">You're on the list.</h1>
    <p style="margin:0 0 16px;color:#d5d5d5;">
      thalamus is the control plane and memory for agentic work &mdash; one memory,
      one trust gate, and durable jobs across swappable engines.
    </p>
    <p style="margin:0 0 16px;color:#9a9a9a;">
      We'll email you when there's a build worth self-hosting. Nothing else, and we
      won't share your address.
    </p>
    <p style="margin:0 0 30px;color:#8a8a8a;font-size:13.5px;">
      If you didn't sign up, ignore this &mdash; the address is only used to send
      that one announcement.
    </p>
    <p style="margin:0;padding-top:20px;border-top:1px solid rgba(255,255,255,0.09);">
      <a href="https://openthalamus.dev" style="color:#c9c9c9;font-size:13px;">openthalamus.dev</a>
    </p>
  </div>
</body></html>`;

  return { to, subject, text, html };
}
