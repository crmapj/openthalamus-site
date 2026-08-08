/**
 * Ad-hoc DOM probe over CDP. Evaluates an expression in the real page at a
 * given scroll position and prints the result.
 *
 *   node scripts/qa-probe.mjs <scrollFraction> '<js expression>'
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:4399/";
const INIT = process.env.QA_INIT ?? "";
const FRAC = Number(process.argv[2] ?? 0);
const EXPR = process.argv[3] ?? "1";
const WIDTH = Number(process.env.QA_WIDTH ?? 1440);
const HEIGHT = Number(process.env.QA_HEIGHT ?? 900);
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
    `--window-size=${WIDTH},${HEIGHT}`,
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
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});
if (INIT) {
  await cdp(ws, ++id, "Page.addScriptToEvaluateOnNewDocument", {
    source: INIT,
  });
}
await cdp(ws, ++id, "Page.navigate", { url: BASE });
await sleep(1800);

await cdp(ws, ++id, "Runtime.evaluate", {
  expression: `window.scrollTo({top: Math.round((document.documentElement.scrollHeight - innerHeight) * ${FRAC}), behavior: "instant"}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  awaitPromise: true,
});
await sleep(Number(process.env.QA_WAIT ?? 250));

const out = await cdp(ws, ++id, "Runtime.evaluate", {
  expression: `Promise.resolve((async()=>{ ${EXPR} })()).then(v => JSON.stringify(v, null, 2))`,
  awaitPromise: true,
  returnByValue: true,
});
if (out.exceptionDetails) {
  throw new Error(out.exceptionDetails.exception?.description ?? "probe expression threw");
}
console.log(out.result.value ?? out.result.description);

ws.close();
chrome.kill();
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
