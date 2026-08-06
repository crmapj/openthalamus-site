/**
 * Captures a beat's motion as a filmstrip at a given viewport.
 *
 * A single screenshot cannot show whether an animation works — the failure mode
 * that started this was "no motion at all", which looks identical to a correct
 * static frame in one picture. This walks each pinned beat's own scroll
 * progress (0 → 1) and captures frames, so the sequence is visible.
 *
 *   node scripts/motion-shots.mjs [width] [height] [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";

const W = Number(process.argv[2] ?? 390);
const H = Number(process.argv[3] ?? 844);
const BASE = process.argv[4] ?? "http://127.0.0.1:4399/";
const OUT = new URL("../.qa/", import.meta.url).pathname;
const PORT = 9351;
const PROFILE = new URL("../.qa-profile-motion/", import.meta.url).pathname;
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

await mkdir(OUT, { recursive: true });
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
const chrome = spawn(
  process.env.CHROMIUM_BIN ?? "chromium",
  ["--headless","--disable-gpu","--no-sandbox","--hide-scrollbars",
   `--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
   `--window-size=${W},${H}`,"about:blank"],
  { stdio: "ignore" },
);
let target;
for (let i = 0; i < 60; i++) {
  try {
    target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
    break;
  } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
await cdp(ws, ++id, "Page.enable");
await cdp(ws, ++id, "Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: W < 800 });
if (W < 800) await cdp(ws, ++id, "Emulation.setTouchEmulationEnabled", { enabled: true });
await cdp(ws, ++id, "Page.navigate", { url: BASE });
await sleep(2400);

const state = await cdp(ws, ++id, "Runtime.evaluate", { returnByValue: true, expression:
  `JSON.stringify({motion: document.documentElement.classList.contains("motion"),
                   pins: [...document.querySelectorAll(".pin")].map(p=>({beat:p.dataset.beat, motion:p.classList.contains("pin--motion"), h:p.offsetHeight}))})` });
console.log(`${W}x${H} ->`, state.result.value);

for (const beat of ["alive", "grow", "kernel"]) {
  for (const prog of [0.15, 0.4, 0.65, 0.9]) {
    await cdp(ws, ++id, "Runtime.evaluate", { awaitPromise: true, expression: `(async()=>{
      const pin=document.querySelector('[data-beat="${beat}"]');
      if(!pin) return;
      const span = Math.max(1, pin.offsetHeight - innerHeight);
      window.scrollTo({top: Math.round(pin.offsetTop + span * ${prog}), behavior:'instant'});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      await new Promise(r=>setTimeout(r,320));
    })()` });
    const shot = await cdp(ws, ++id, "Page.captureScreenshot", { format: "png" });
    await writeFile(`${OUT}mo${W}-${beat}-${String(prog * 100).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
  }
}
console.log("filmstrips written to .qa/");
ws.close();
chrome.kill();
await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
