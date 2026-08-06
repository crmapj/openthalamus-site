/**
 * Ad-hoc DOM probe over CDP. Evaluates an expression in the real page at a
 * given scroll position and prints the result.
 *
 *   node scripts/qa-probe.mjs <scrollFraction> '<js expression>'
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:4399/";
const FRAC = Number(process.argv[2] ?? 0);
const EXPR = process.argv[3] ?? "1";
const PORT = 9334;
const PROFILE = new URL("../.qa-profile2/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

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

let target;
for (let i = 0; i < 50; i++) {
  try {
    target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, { method: "PUT" })
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
await cdp(ws, ++id, "Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await cdp(ws, ++id, "Page.navigate", { url: BASE });
await sleep(1800);

await cdp(ws, ++id, "Runtime.evaluate", {
  expression: `window.scrollTo({top: Math.round((document.documentElement.scrollHeight - innerHeight) * ${FRAC}), behavior: "instant"}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  awaitPromise: true,
});
await sleep(250);

const out = await cdp(ws, ++id, "Runtime.evaluate", {
  expression: `JSON.stringify((()=>{ ${EXPR} })(), null, 2)`,
  returnByValue: true,
});
console.log(out.result.value ?? out.result.description);

ws.close();
chrome.kill();
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
