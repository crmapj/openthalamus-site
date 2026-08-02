/**
 * The waitlist confirmation, in the cbrain visual language.
 *
 * Email HTML is not web HTML. The constraints that shape everything below:
 *   - Outlook renders through Word, so layout is tables, never flexbox or grid.
 *   - <style> blocks and classes are stripped by several clients; all styling
 *     is inline.
 *   - SVG is stripped almost everywhere, and remote images are blocked by
 *     default in Gmail and Outlook — so the mark is drawn with table cells and
 *     the design must read perfectly with zero images loaded. It does; there
 *     are no images at all.
 *   - Dark backgrounds get inverted by some clients. bgcolor attributes sit
 *     alongside CSS so the intent survives, and `color-scheme` tells modern
 *     clients we already are dark.
 *   - A text/plain part is mandatory: some clients only render it, and its
 *     absence measurably worsens spam scoring.
 */

const BG = "#0a0a0a";
const CARD = "#0e0e0e";
const LINE = "#1c1c1c"; // hairline — rgba is unreliable in email clients
const TEXT = "#d5d5d5";
const BRIGHT = "#f2f2f2";
const MUTED = "#9a9a9a";
const DIM = "#8a8a8a";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,Menlo,Consolas,'Courier New',monospace";

/** One dot of the three-node mark, drawn as a rounded table cell. */
function dot(size = 9, color = BRIGHT): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td width="${size}" height="${size}" style="width:${size}px;height:${size}px;background:${color};border-radius:${size}px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

function row(label: string, body: string): string {
  return `
  <tr>
    <td style="padding:0 0 18px 0;">
      <div style="font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${DIM};padding-bottom:5px;">${label}</div>
      <div style="font-family:${SANS};font-size:14.5px;line-height:1.55;color:${MUTED};">${body}</div>
    </td>
  </tr>`;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function waitlistConfirmationMail(): RenderedMail {
  const subject = "You're on the thalamus waitlist";

  const text = `You're on the list.

thalamus is the control plane and memory for agentic work — a self-hosted
meta-layer over coding agents.

  ONE MEMORY      Conversations, notes and decisions fold into a single store.
                  No session starts cold.

  ONE TRUST GATE  Confident, reversible work proceeds and logs. Anything
                  irreversible waits for you.

  META-HARNESS    It owns jobs, results, cost and resume. Engines are
                  replaceable fuel.

WHAT HAPPENS NEXT
You'll get one email when there's a build worth self-hosting. Not a newsletter,
not a drip sequence — one email. We won't share your address.

  https://openthalamus.dev

Reply to this message any time — a human reads it. Reply "remove" and you're
off the list, no hard feelings.

thalamus · MIT licensed · pre-release`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BG};" bgcolor="${BG}">

<!-- Preheader: the grey preview line next to the subject in most inboxes.
     Hidden in the body itself, then padded so no other copy leaks into it. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">
  One email when there's a build worth self-hosting. Nothing else.
  &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr>
<td align="center" style="padding:36px 14px 48px 14px;">

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">

    <!-- mark + wordmark -->
    <tr>
      <td style="padding:0 4px 26px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:11px;vertical-align:middle;">
              <!-- Explicit widths: without them the apex dot renders left of
                   centre, because the row above sizes the column by content. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="27" style="width:27px;">
                <tr><td width="27" align="center" style="padding-bottom:5px;font-size:0;line-height:0;">${dot(7)}<span style="display:inline-block;width:11px;">&nbsp;</span>${dot(7)}</td></tr>
                <tr><td width="27" align="center" style="font-size:0;line-height:0;">${dot(7, DIM)}</td></tr>
              </table>
            </td>
            <td style="vertical-align:middle;font-family:${SANS};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:${BRIGHT};">thalamus</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- card -->
    <tr>
      <td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:34px 30px 30px 30px;">

        <div style="font-family:${MONO};font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${DIM};padding-bottom:16px;">Waitlist &middot; confirmed</div>

        <h1 style="margin:0 0 16px 0;font-family:${SANS};font-size:27px;line-height:1.18;letter-spacing:-0.025em;font-weight:600;color:${BRIGHT};">You're on the list.</h1>

        <p style="margin:0 0 28px 0;font-family:${SANS};font-size:15.5px;line-height:1.6;color:${TEXT};">
          thalamus is the control plane and memory for agentic work &mdash; a self-hosted
          meta-layer over coding agents that turns cheap, abundant code into coherent,
          governed progress.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};padding-top:4px;">
          <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
          ${row("One memory", "Conversations, notes and decisions fold into a single store. No session starts cold.")}
          ${row("One trust gate", "Confident, reversible work proceeds and logs. Anything irreversible waits for you.")}
          ${row("A meta-harness", "It owns jobs, results, cost and resume. Engines are replaceable fuel.")}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};">
          <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td>
              <div style="font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${DIM};padding-bottom:7px;">What happens next</div>
              <p style="margin:0 0 22px 0;font-family:${SANS};font-size:14.5px;line-height:1.6;color:${MUTED};">
                You'll get <strong style="color:${TEXT};font-weight:600;">one email</strong> when there's a build
                worth self-hosting. Not a newsletter, not a drip sequence. We won't share your address.
              </p>
            </td>
          </tr>
          <tr>
            <td>
              <!-- Bulletproof button: a padded table cell, not a styled <a>, so
                   Outlook renders the fill rather than dropping to a bare link. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${BRIGHT}" style="background:${BRIGHT};border-radius:8px;">
                    <a href="https://openthalamus.dev" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:14.5px;font-weight:600;color:#0a0a0a;text-decoration:none;">Read what it is &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>

    <!-- footer -->
    <tr>
      <td style="padding:22px 6px 0 6px;">
        <p style="margin:0 0 8px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${DIM};">
          Reply to this message any time &mdash; a human reads it.
          Reply <span style="font-family:${MONO};color:${MUTED};">remove</span> and you're off the list, no hard feelings.
        </p>
        <p style="margin:0;font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6a6a6a;">
          thalamus &middot; MIT licensed &middot; pre-release
        </p>
      </td>
    </tr>

  </table>

</td>
</tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
