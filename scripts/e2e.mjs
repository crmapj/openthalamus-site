/**
 * End-to-end checks against a running server.
 *
 * Drives a real Chromium over CDP — not curl against the endpoint — because the
 * things most likely to break are in the browser: the attribution capture that
 * reads `document.referrer` on arrival and has to survive an 11,000px scroll to
 * the form, the lazily-injected Turnstile, and the success state that swaps
 * itself into the form's grid cell. A request-level test would pass while all
 * three were broken.
 *
 * Asserts across three layers: DOM (what the visitor sees), HTTP (head tags,
 * crawler files), and SQLite (what actually got stored, including the derived
 * acquisition channel).
 *
 *   node scripts/e2e.mjs [baseUrl] [dbPath]
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import Database from "better-sqlite3";

const BASE = process.argv[2] ?? "http://127.0.0.1:4399/";
const DB = process.argv[3] ?? "/tmp/qa2.db";
const PORT = 9335;
const PROFILE = new URL("../.qa-profile-e2e/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// ── 1. HTTP layer ────────────────────────────────────────────────────────────
console.log("\nHTTP");
const html = await (await fetch(BASE)).text();

check("title states the agentic OS positioning", /<title>[^<]*agentic OS[^<]*<\/title>/.test(html));
check("no stale 'control plane' in the visible copy", !/>\s*[^<]*control plane and memory/.test(html));
check("og:image is a PNG", /property="og:image" content="[^"]+\.png"/.test(html));
check("og:image dimensions declared", /og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html));
check("og:image:alt present", /og:image:alt" content="[^"]+"/.test(html));
check("twitter summary_large_image", /name="twitter:card" content="summary_large_image"/.test(html));
check("canonical is absolute", /rel="canonical" href="https:\/\//.test(html));
check("robots allows max snippet", /max-snippet:-1/.test(html));

const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
let graph = [];
try {
  graph = JSON.parse(ld[1])["@graph"];
} catch {
  /* handled by the check below */
}
check("JSON-LD parses", graph.length > 0);
check("JSON-LD has 4 entities", graph.length === 4, `got ${graph.length}`);
check("no aggregateRating (no real ratings exist)", !graph.some((n) => n.aggregateRating));
check("no SearchAction (retired 2024)", !/SearchAction/.test(ld?.[1] ?? ""));
check("JSON-LD subcategory repositioned", graph.some((n) => /Agentic operating system/.test(n.applicationSubCategory ?? "")));

const ogRes = await fetch(new URL("/og.png", BASE));
check("og.png serves 200 image/png", ogRes.ok && ogRes.headers.get("content-type") === "image/png");

const robots = await (await fetch(new URL("/robots.txt", BASE))).text();
check("robots.txt permits everything but /api/", /Allow: \/\n/.test(robots) && /Disallow: \/api\//.test(robots));
check("robots.txt carries permissive Content-Signal", /ai-train=yes/.test(robots) && /ai-input=yes/.test(robots));
check("robots.txt has no per-bot Allow groups (RFC 9309 trap)", !/User-agent: GPTBot/i.test(robots));

const llms = await (await fetch(new URL("/llms.txt", BASE))).text();
check("llms.txt leads with agentic OS", /agentic OS/.test(llms.split("\n").slice(0, 12).join(" ")));
check("llms.txt carries the bet", /## The bet/.test(llms));
check("llms.txt links resolve to real anchors only", !/\/architecture\)|\/docs\)|\/engines\)/.test(llms));

// Astro renders `<!-- -->` straight into the shipped page but strips `{/* */}`.
// An internal note explaining a design decision — or naming someone, or
// describing the state of a private repo — becomes public page source. Use the
// JSX form in template bodies.
const htmlComments = [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((m) =>
  m[1].trim().slice(0, 60),
);
check("no HTML comments leak into the shipped page", htmlComments.length === 0, htmlComments.join(" | "));

// Dead links: every internal href must be a real anchor or file.
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
check("no dead href=# links", !hrefs.some((h) => h === "#" || h === ""));
const anchors = hrefs.filter((h) => h.startsWith("#"));
const missing = anchors.filter((h) => !html.includes(`id="${h.slice(1)}"`));
check("every in-page anchor has a target", missing.length === 0, missing.join(", "));

// ── 2. Browser layer ─────────────────────────────────────────────────────────
console.log("\nBrowser");
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
const chrome = spawn(
  process.env.CHROMIUM_BIN ?? "chromium",
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

// Opened blank on purpose: navigating a tab to the URL it is already on does
// not populate `document.referrer`, so the attribution assertion would fail
// against a page that is actually fine.
let target;
for (let i = 0; i < 60; i++) {
  try {
    target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, {
        method: "PUT",
      })
    ).json();
    break;
  } catch {
    await sleep(200);
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
await cdp(ws, ++id, "Page.enable");
await cdp(ws, ++id, "Network.enable");
await cdp(ws, ++id, "Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

// Arrive as if an answer engine sent us — the channel that matters most here.
//
// Two things this gets right that are easy to get wrong:
//
// 1. The referrer goes through `Page.navigate`'s own parameter and nothing
//    else. Setting `Referer` via `Network.setExtraHTTPHeaders` is a forbidden
//    header, and Chromium aborts the navigation to `chrome-error://` — which
//    then fails every DOM assertion for a reason that looks like a site bug.
// 2. The referrer scheme matches the target's. Under the default
//    `strict-origin-when-cross-origin` policy a secure→insecure navigation has
//    its referrer stripped entirely, so an `https://` referrer arrives empty at
//    an `http://` dev server. Production is HTTPS with HSTS, so the real
//    journey is https→https and nothing is stripped; testing over local HTTP
//    just has to use an http referrer to reproduce it.
const REFERRER = new URL(BASE).protocol === "https:" ? "https://chatgpt.com/" : "http://chatgpt.com/";
await cdp(ws, ++id, "Page.navigate", { url: BASE, referrer: REFERRER });
await sleep(2000);

const evalJs = async (expression) => {
  const r = await cdp(ws, ++id, "Runtime.evaluate", {
    expression: `Promise.resolve((async()=>{ ${expression} })()).then(v=>JSON.stringify(v))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "evaluate threw");
  }
  return JSON.parse(r.result.value);
};

// A blank or errored page would otherwise fail every DOM assertion below for a
// reason that has nothing to do with the site.
const loaded = await evalJs(`return { url: location.href, nodes: document.querySelectorAll("section").length };`);
check("page actually loaded", loaded.url.startsWith(BASE) && loaded.nodes > 3, loaded.url);

const faq = await evalJs(`
  const items = [...document.querySelectorAll(".q-item")];
  return {
    count: items.length,
    firstOpen: items[0]?.open === true,
    othersClosed: items.slice(1).every(d => !d.open),
    answersInDom: items.every(d => (d.querySelector(".q-a p")?.textContent || "").length > 40),
    numbered: [...document.querySelectorAll(".q-num")].map(n => n.textContent),
  };`);
check("FAQ renders 8 items", faq.count === 8, `got ${faq.count}`);
check("FAQ first item open, rest closed", faq.firstOpen && faq.othersClosed);
// `every` on an empty list is vacuously true, so this has to be gated on count.
check("FAQ answers are in the DOM even when collapsed", faq.count === 8 && faq.answersInDom);
check("FAQ rows are indexed 01..08", faq.numbered.join(",") === "01,02,03,04,05,06,07,08");

// Click a closed row and confirm it opens — the "dynamic click-out".
const toggled = await evalJs(`
  const d = document.querySelectorAll(".q-item")[2];
  d.querySelector("summary").click();
  await new Promise(r => setTimeout(r, 400));
  return { open: d.open, visible: d.querySelector(".q-a").getBoundingClientRect().height > 10 };`);
check("clicking a question expands it", toggled.open && toggled.visible);

const turnstile = await evalJs(`
  const el = document.querySelector(".cf-turnstile");
  return { present: !!el, appearance: el?.getAttribute("data-appearance") ?? null };`);
check(
  "Turnstile is interaction-only when configured",
  !turnstile.present || turnstile.appearance === "interaction-only",
  `appearance=${turnstile.appearance}`,
);

const attr = await evalJs(`
  return {
    ref: document.getElementById("f-ref")?.value ?? "",
    landing: document.getElementById("f-landing")?.value ?? "",
  };`);
check("attribution captured the referrer", /chatgpt\.com/.test(attr.ref), `ref=${attr.ref}`);

/*
 * The write path is only exercised locally, and that is a deliberate limit
 * rather than a gap.
 *
 * Against production the endpoint requires a Turnstile token, and Turnstile
 * correctly refuses to issue one to an automated browser — that refusal is the
 * protection working, so asserting a successful signup there would mean either
 * weakening the protection or reporting a false failure forever. Locally the
 * secret is unset, `turnstileOk` returns true, and the full journey through
 * form → endpoint → SQLite is real.
 *
 * What production still proves: the form renders, the widget is configured
 * interaction-only, and the whole HTTP surface is correct.
 */
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

if (!isLocal) {
  // Turnstile is injected only when the waitlist comes within two viewports, so
  // checking from the top of an 11,000px page tests nothing but the scroll
  // position. Scroll there and give the script time to initialise.
  const wired = await evalJs(`
    document.getElementById("waitlist").scrollIntoView({ block: "center", behavior: "instant" });
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('[name="cf-turnstile-response"]')) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const f = document.getElementById("waitlist-form");
    return {
      form: !!f,
      action: f?.getAttribute("action"),
      email: !!document.getElementById("email"),
      hiddenAttr: !!document.getElementById("f-ref"),
      turnstileInit: !!document.querySelector('[name="cf-turnstile-response"]'),
      result: !!document.getElementById("result"),
    };`);
  check("form is present and points at the endpoint", wired.form && wired.action === "/api/waitlist");
  check("attribution fields are wired into the form", wired.hiddenAttr);
  check("Turnstile initialised (hidden response field created)", wired.turnstileInit);
  check("result container exists for the success swap", wired.result);
  console.log(
    "  note  write path not exercised against production — Turnstile correctly\n" +
      "        refuses an automated browser. Run against a local server for that.",
  );

  ws.close();
  chrome.kill();
  await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

// Submit the form for real.
const email = `e2e-${Date.now()}@example.com`;
const submitted = await evalJs(`
  const input = document.getElementById("email");
  input.value = ${JSON.stringify(email)};
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("waitlist-form").requestSubmit();
  for (let i = 0; i < 60; i++) {
    const r = document.getElementById("result");
    if (r?.classList.contains("show")) {
      return {
        ok: true,
        outcome: r.getAttribute("data-outcome"),
        title: document.getElementById("result-title").textContent,
        receipt: document.getElementById("result-receipt").textContent,
        formHidden: document.getElementById("waitlist-form").classList.contains("form-hidden"),
      };
    }
    const err = document.getElementById("form-err");
    if (err && !err.hidden) return { ok: false, error: err.textContent };
    await new Promise(r2 => setTimeout(r2, 250));
  }
  return { ok: false, error: "timed out" };`);

check("form submits and shows success", submitted.ok, submitted.error);
check("success outcome is 'added'", submitted.outcome === "added", submitted.outcome);
check("success replaces the form", submitted.formHidden === true);
check("receipt echoes the address", (submitted.receipt ?? "").includes(email), submitted.receipt);

// Resubmitting the same address must be recognised, not duplicated.
const dup = await evalJs(`
  const res = await fetch("/api/waitlist", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({ email: ${JSON.stringify(email)}, ref: "https://chatgpt.com/" }),
  });
  return await res.json();`);
check("duplicate address returns 'already'", dup.outcome === "already", JSON.stringify(dup));

ws.close();
chrome.kill();
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});

// ── 3. Storage layer ─────────────────────────────────────────────────────────
console.log("\nStorage");
const db = new Database(DB, { readonly: true });
const row = db.prepare("SELECT * FROM waitlist WHERE email = ?").get(email);
check("row landed in SQLite", !!row);
check("referrer stored", /chatgpt\.com/.test(row?.referrer ?? ""), row?.referrer);
check("channel derived as 'chatgpt'", row?.channel === "chatgpt", row?.channel);
check("landing path stored", (row?.landing ?? "").startsWith("/"), row?.landing);
check("ip is hashed, not raw", !!row?.ip_hash && !/^\d+\.\d+\.\d+\.\d+$/.test(row?.ip_hash ?? ""));
const dupCount = db.prepare("SELECT COUNT(*) n FROM waitlist WHERE email = ?").get(email).n;
check("no duplicate row written", dupCount === 1, `${dupCount} rows`);
db.close();

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
