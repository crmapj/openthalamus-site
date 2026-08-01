import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { getDb, normaliseEmail, rateLimited } from "../../lib/db";

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

function reply(req: Request, status: number, message: string) {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) {
    return new Response(JSON.stringify({ ok: status < 400, message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  // No-JS fallback: bounce back to the anchor with the outcome in the query.
  const to = status < 400 ? "/?joined=1#waitlist" : "/?error=1#waitlist";
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
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowed = (process.env.ALLOWED_ORIGIN_HOSTS ?? "openthalamus.dev,www.openthalamus.dev,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  try {
    return allowed.includes(new URL(origin).hostname.toLowerCase());
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

  try {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO waitlist (email, email_norm, ip_hash, user_agent, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email_norm) DO NOTHING`,
      )
      .run(
        email,
        normaliseEmail(email),
        ipHash,
        (request.headers.get("user-agent") ?? "").slice(0, 300),
        "landing",
      );

    // Same response whether it inserted or was already present — never confirm
    // to a stranger whether a given address is on the list.
    return reply(
      request,
      200,
      info.changes > 0 ? "You're on the list." : "You're on the list.",
    );
  } catch (err) {
    console.error("waitlist insert failed:", err);
    return reply(request, 500, "Could not save that right now. Try again shortly.");
  }
};

// A bare GET should not 500; send people to the form.
export const GET: APIRoute = () =>
  new Response(null, { status: 303, headers: { location: "/#waitlist" } });
