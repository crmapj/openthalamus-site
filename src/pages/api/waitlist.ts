import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { classifyChannel, getDb, normaliseEmail, rateLimited } from "../../lib/db";
import { sendMail, waitlistConfirmation } from "../../lib/email";

// The only server-rendered route on the site. Everything else is static HTML.
export const prerender = false;

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY ?? "";
const IP_SALT = process.env.IP_HASH_SALT ?? "openthalamus-waitlist";

/** Store a salted hash, never the address — enough to rate-limit, not to track. */
function hashIp(ip: string): string {
  return createHash("sha256").update(IP_SALT).update(ip).digest("hex").slice(0, 32);
}

function clientIp(req: Request): string {
  // Behind Cloudflare then Traefik. CF-Connecting-IP is the only header of
  // these that a client cannot forge, because Cloudflare overwrites it.
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

type Outcome = "added" | "already" | "error";

function reply(req: Request, status: number, message: string, outcome: Outcome = status < 400 ? "added" : "error") {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) {
    return new Response(JSON.stringify({ ok: status < 400, outcome, message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  // No-JS fallback: bounce back to the anchor with the outcome in the query.
  const to =
    outcome === "added" ? "/?joined=1#waitlist"
    : outcome === "already" ? "/?already=1#waitlist"
    : "/?error=1#waitlist";
  return new Response(null, { status: 303, headers: { location: to } });
}

async function turnstileOk(token: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true; // not provisioned yet — other layers still apply
  if (!token) return false;
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Fail OPEN on a Cloudflare outage: losing real signups is worse than
    // admitting a few bots, and the honeypot + rate limit still stand.
    return true;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/**
 * Proxy-aware CSRF origin check, replacing Astro's built-in one.
 *
 * Astro's version compares Origin to the host the *server* sees. Behind
 * Cloudflare and Traefik that is an internal http:// host while the browser
 * sends https://openthalamus.dev, so it rejects every real submission. We match
 * the Origin's hostname against an explicit allowlist instead, which is immune
 * to how many proxies sit in front.
 *
 * A missing Origin is allowed: non-browser clients (curl, no-JS form posts from
 * some older browsers) omit it, and every other defence still applies.
 */
function ownHosts(): string[] {
  return (process.env.ALLOWED_ORIGIN_HOSTS ?? "openthalamus.dev,www.openthalamus.dev,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return ownHosts().includes(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True when a referrer is one of our own hostnames.
 *
 * Compared against the configured host allowlist rather than against
 * `request.url`. Behind Cloudflare and Traefik the server sees an internal
 * origin like `http://10.0.0.4:4321` while the browser sends
 * `https://openthalamus.dev/` — so a `request.url` comparison never matches,
 * and every direct visitor would be filed as a referral from our own site.
 */
function isOwnReferrer(referrer: string): boolean {
  try {
    return ownHosts().includes(new URL(referrer).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!originAllowed(request)) {
    return reply(request, 403, "Request blocked.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(request, 400, "Malformed submission.");
  }

  // 1. Honeypot — a hidden field only an automated filler would populate.
  if (String(form.get("company") ?? "").trim() !== "") {
    // Answer as though it worked so scrapers get no signal to adapt to.
    return reply(request, 200, "You're on the list.");
  }

  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return reply(request, 400, "That email doesn't look right.");
  }

  const ip = clientIp(request);
  const ipHash = hashIp(ip);

  // 2. Rate limit before the network call, so a flood cannot cost us upstream requests.
  if (rateLimited(ipHash)) {
    return reply(request, 429, "Too many attempts. Try again later.");
  }

  // 3. Turnstile.
  const token = String(form.get("cf-turnstile-response") ?? "");
  if (!(await turnstileOk(token, ip))) {
    return reply(request, 403, "Verification failed. Please try again.");
  }

  // 4. Attribution. The client captures the referrer on arrival and carries it
  //    to submit; the Referer header is only a fallback, because by the time
  //    this POST fires the browser reports our own origin.
  const trim = (v: FormDataEntryValue | null) => String(v ?? "").slice(0, 300);
  const claimed = trim(form.get("ref")) || (request.headers.get("referer") ?? "").slice(0, 300);
  // Our own pages are navigation, not acquisition. Filtering here as well as in
  // the client keeps the header fallback from filing every direct visitor as a
  // referral from openthalamus.dev.
  const referrer = isOwnReferrer(claimed) ? "" : claimed;
  const utm = trim(form.get("utm"));
  const landing = trim(form.get("landing"));
  const channel = classifyChannel(referrer, utm);

  try {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO waitlist
           (email, email_norm, ip_hash, user_agent, source, referrer, utm, landing, channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email_norm) DO NOTHING`,
      )
      .run(
        email,
        normaliseEmail(email),
        ipHash,
        (request.headers.get("user-agent") ?? "").slice(0, 300),
        "landing",
        referrer,
        utm,
        landing,
        channel,
      );

    // We DO distinguish "added" from "already on the list" (Chris, 2026-08-02).
    // That is a deliberate trade: it leaks whether an address is on the waitlist
    // to anyone who can guess it, which for a public pre-release list is worth
    // far less than a person knowing their second submit was not lost. The rate
    // limiter still stops anyone enumerating at scale.
    if (info.changes > 0) {
      // Fire and forget. The address is already committed, so a slow or failing
      // mail hop must not delay the response or turn a successful signup into a
      // visible error. sendMail never throws.
      void sendMail(waitlistConfirmation(email));
      return reply(request, 200, "You're on the list.", "added");
    }
    // Deliberately no second email on a repeat submit — re-confirming an address
    // that is already on the list is how a signup form becomes a spam cannon.
    return reply(request, 200, "You're already on the list.", "already");
  } catch (err) {
    console.error("waitlist insert failed:", err);
    return reply(request, 500, "Could not save that right now. Try again shortly.");
  }
};

// A bare GET should not 500; send people to the form.
export const GET: APIRoute = () =>
  new Response(null, { status: 303, headers: { location: "/#waitlist" } });
