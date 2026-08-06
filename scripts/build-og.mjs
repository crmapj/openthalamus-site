/**
 * Generates public/og.png — the social + AI-crawler preview card.
 *
 * Why a script and not a hand-drawn SVG: SVG `og:image` does not work. Facebook,
 * X, LinkedIn, Slack, Discord and iMessage all fail to render it, and AI preview
 * fetchers are no better — Anthropic's crawler spends ~35% of its requests on
 * images, so a broken card is a wasted signal. The spec wants a raster.
 *
 * Rendered through headless Chromium rather than librsvg because the design uses
 * the system font stack with tight negative tracking, and librsvg's text layout
 * does not match a browser's.
 *
 *   node scripts/build-og.mjs
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const W = 1200;
const H = 630;
const OUT = new URL("../public/og.png", import.meta.url).pathname;

const MARK = `
<svg width="120" height="78" viewBox="8 22 80 52" fill="none">
  <path d="M30 27 C40 27 45.5 40.7 45.5 51.2 C45.5 63.8 38.5 69 30 69 C21.5 69 14.5 63.8 14.5 51.2 C14.5 40.7 20 27 30 27 Z" fill="#f2f2f2" transform="rotate(-18 30 48)"/>
  <path d="M66 27 C76 27 81.5 40.7 81.5 51.2 C81.5 63.8 74.5 69 66 69 C57.5 69 50.5 63.8 50.5 51.2 C50.5 40.7 56 27 66 27 Z" fill="#f2f2f2" transform="rotate(18 66 48)"/>
</svg>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:${W}px;height:${H}px;background:#0a0a0a;color:#f2f2f2;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex;flex-direction:column;justify-content:center;
    padding:0 88px;position:relative;overflow:hidden;
  }
  /* The same dot grid the pinned stages use, so the card reads as the product. */
  .grid{position:absolute;inset:0;background:radial-gradient(rgba(255,255,255,0.03) 1px,transparent 1px) 0 0/26px 26px}
  .edge{position:absolute;inset:0;border:1px solid rgba(255,255,255,0.09)}
  .inner{position:relative;display:flex;flex-direction:column;gap:26px}
  .brandline{display:flex;align-items:center;gap:20px}
  .wordmark{font-size:44px;font-weight:650;letter-spacing:-0.03em}
  .dot{width:11px;height:11px;border-radius:50%;background:#e8e8e8}
  h1{font-size:58px;line-height:1.06;font-weight:650;letter-spacing:-0.04em;max-width:22ch}
  h1 .dim{color:#6a6a6a}
  .sub{font-size:24px;line-height:1.45;color:#a8a8a8;max-width:40ch}
  .foot{
    position:absolute;left:88px;bottom:58px;display:flex;align-items:center;gap:14px;
    font-family:ui-monospace,Menlo,Monaco,"SF Mono",monospace;
    font-size:17px;letter-spacing:0.16em;text-transform:uppercase;color:#7a7a7a;
  }
  .foot .sep{color:#3a3a3a}
</style></head>
<body>
  <div class="grid"></div><div class="edge"></div>
  <div class="inner">
    <div class="brandline">${MARK}<span class="wordmark">thalamus</span><span class="dot"></span></div>
    <h1><span class="dim">There will be many like it.</span> This one is yours.</h1>
    <p class="sub">The fully extensible, self-hosted agentic OS.</p>
  </div>
  <div class="foot">
    <span>Open source</span><span class="sep">·</span>
    <span>Self-hosted</span><span class="sep">·</span>
    <span>MIT</span><span class="sep">·</span>
    <span>openthalamus.dev</span>
  </div>
</body></html>`;

// Staged inside the repo, not /tmp: a snap-confined Chromium (the default on
// Ubuntu) cannot read /tmp and silently screenshots its own ERR_FILE_NOT_FOUND
// page instead of failing loudly.
const dir = new URL("../.og-build/", import.meta.url).pathname;
await mkdir(dir, { recursive: true });
const page = join(dir, "og.html");
await writeFile(page, html, "utf8");

const chromium = process.env.CHROMIUM_BIN ?? "chromium";
const args = [
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  `--window-size=${W},${H}`,
  `--screenshot=${OUT}`,
  `file://${page}`,
];

await new Promise((resolve, reject) => {
  const p = spawn(chromium, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(`chromium exited ${code}\n${err}`)),
  );
  p.on("error", reject);
});

await rm(dir, { recursive: true, force: true });
console.log(`og.png written: ${OUT} (${W}x${H})`);
