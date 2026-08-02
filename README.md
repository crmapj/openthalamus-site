# openthalamus.dev

Landing page and waitlist for [thalamus](https://github.com/crmapj/thalamus).

**Stack:** Astro 5 (static output) + Node adapter for a single server endpoint,
SQLite for the waitlist, Docker, deployed by Coolify on `ovh-vps`, fronted by
Cloudflare.

Static-by-default is the SEO argument: every marketing page is prerendered HTML
with inlined CSS and no client framework. Only `/api/waitlist` renders per
request.

## Spam protection (layered)

1. **Honeypot** — a hidden `company` field. Filled ⇒ we answer "you're on the
   list" and store nothing, so scrapers get no signal to adapt to.
2. **Rate limit** — 5 submissions per hour per salted IP hash, in SQLite.
3. **Cloudflare Turnstile** — verified server-side. Fails *open* on a Cloudflare
   outage, because losing real signups is worse than admitting a few bots.
4. **Origin allowlist** — proxy-aware CSRF check (see below).

Emails are de-duplicated on a normalised form (lowercased, `+tags` and Gmail
dots collapsed), and the response never reveals whether an address was already
present.

## Gotcha: Astro's CSRF check breaks behind a proxy

`security.checkOrigin` compares `Origin` to the host the *server* sees. Behind
Cloudflare + Traefik that is an internal `http://` host while the browser sends
`https://openthalamus.dev`, so it rejects every real submission. It is disabled
in `astro.config.mjs` and replaced by an explicit hostname allowlist in the
endpoint (`ALLOWED_ORIGIN_HOSTS`).

## Environment

| Var | Purpose |
|---|---|
| `WAITLIST_DB_PATH` | SQLite path (default `/data/waitlist.db`; mount a volume) |
| `PUBLIC_TURNSTILE_SITE_KEY` | **Build-time** — Astro inlines `PUBLIC_*` |
| `TURNSTILE_SECRET_KEY` | Runtime, server-side verification |
| `IP_HASH_SALT` | Salt for IP hashing |
| `ALLOWED_ORIGIN_HOSTS` | CSV of accepted Origin hostnames |
| `CLOUDFLARE_EMAIL_TOKEN` | API token with **Email Sending: Edit**. Absent ⇒ mail is skipped and logged, signups still work |
| `MAIL_FROM` / `MAIL_FROM_NAME` | Sender (default `hello@openthalamus.dev` / `thalamus`) |
| `MAIL_REPLY_TO` | Where replies go |

## Confirmation email

Sent through Cloudflare Email Service's SMTP endpoint (`smtp.mx.cloudflare.net:465`,
implicit TLS, username the literal `api_token`). Sending is **best effort**: the
address is committed before the send is attempted and `sendMail` never throws, so
a slow or failing mail hop cannot fail a signup. A repeat submit sends nothing —
re-confirming an address already on the list is how a form becomes a spam cannon.

## Reading the list

```bash
ssh ovh-vps 'sudo docker exec <container> node -e "
  const d=require(\"better-sqlite3\")(\"/data/waitlist.db\");
  console.log(d.prepare(\"SELECT email,created_at FROM waitlist ORDER BY id\").all());
"'
```
