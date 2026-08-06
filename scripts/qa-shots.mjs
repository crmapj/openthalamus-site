/**
 * Screenshot harness for the scroll beats.
 *
 * The pinned sections cannot be QA'd with `chromium --screenshot`: that captures
 * one viewport at scroll 0, and making the window tall enough to see more breaks
 * every `vh` unit on the page (a 74vh hero becomes 5,180px in a 7,000px window,
 * which reads as a giant blank gap that is not really there).
 *
 * So this drives a real Chromium over the DevTools protocol at a real viewport
 * size and steps the scroll position, which is the only way to see what the
 * beats actually render. No dependencies — Node 22 has a global WebSocket.
 *
 *   node scripts/qa-shots.mjs [baseUrl] [outDir]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:4399/";
const OUT = process.argv[3] ?? new URL("../.qa/", import.meta.url).pathname;
const PORT = 9333;
const PROFILE = new URL("../.qa-profile/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Viewport, reduced-motion flag, and the scroll fractions to capture. */
const RUNS = [
  { name: "desktop", w: 1440, h: 900, reduced: false, at: [0, 0.1, 0.2, 0.3, 0.38, 0.46, 0.56, 0.66, 0.78, 0.88, 0.95, 1] },
  { name: "static", w: 1440, h: 900, reduced: true, at: [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1] },
  { name: "mobile", w: 390, h: 844, reduced: false, at: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] },
];

async function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function run({ name, w, h, reduced, at }) {
  await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--window-size=${w},${h}`,
    "about:blank",
  ];
  if (reduced) args.unshift("--force-prefers-reduced-motion");

  const chrome = spawn(process.env.CHROMIUM_BIN ?? "chromium", args, { stdio: "ignore" });

  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, {
        method: "PUT",
      });
      target = await res.json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!target) {
    chrome.kill();
    throw new Error("chromium devtools never came up");
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));

  let id = 0;
  await cdp(ws, ++id, "Page.enable");
  await cdp(ws, ++id, "Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 500,
  });
  await cdp(ws, ++id, "Page.navigate", { url: BASE });
  await sleep(2400); // entrance animations settle (type-on ends at 1880ms)

  const { result: metrics } = await cdp(ws, ++id, "Runtime.evaluate", {
    expression: "JSON.stringify({sh: document.documentElement.scrollHeight, ih: innerHeight})",
    returnByValue: true,
  });
  const { sh, ih } = JSON.parse(metrics.value);
  const max = Math.max(0, sh - ih);

  for (const frac of at) {
    const y = Math.round(max * frac);
    await cdp(ws, ++id, "Runtime.evaluate", {
      expression: `window.scrollTo({top: ${y}, behavior: "instant"}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
      awaitPromise: true,
    });
    await sleep(180);
    const shot = await cdp(ws, ++id, "Page.captureScreenshot", { format: "png" });
    const label = `${name}-${String(Math.round(frac * 100)).padStart(3, "0")}`;
    await writeFile(OUT + label + ".png", Buffer.from(shot.data, "base64"));
  }

  ws.close();
  chrome.kill();
  await sleep(300);
  console.log(`${name}: ${at.length} frames · page ${sh}px · viewport ${w}x${h}`);
}

await mkdir(OUT, { recursive: true });
for (const r of RUNS) await run(r);
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
console.log(`\nwrote to ${OUT}`);
