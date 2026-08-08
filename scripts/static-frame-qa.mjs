/**
 * Visual and geometric contract for the no-motion product showcase.
 *
 * The static mode is not a degraded page: each existing sequence must resolve
 * to its strongest composed frame. This captures the four product arguments at
 * the viewports where the layout changes and fails on hidden or overlapping
 * content.
 *
 *   node scripts/static-frame-qa.mjs [baseUrl]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4399/";
const OUT = process.env.OUT_DIR ?? ".qa/static-frames";
const ENGINE = process.env.BROWSER ?? "chromium";
const engines = { chromium, firefox, webkit };
if (!engines[ENGINE]) {
  throw new Error(`Unknown BROWSER=${ENGINE}; choose chromium, firefox, or webkit`);
}
const scenarios = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "windows-short", width: 1366, height: 490 },
  { name: "large", width: 2560, height: 1440 },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "phone-landscape", width: 844, height: 390, mobile: true },
];
const frames = {
  anatomy: "[data-anatomy]",
  alive: '[data-beat="alive"]',
  plugins: '[data-beat="grow"]',
  kernel: '[data-beat="kernel"]',
};

await fs.mkdir(OUT, { recursive: true });
const browser = await engines[ENGINE].launch({ headless: true });
const result = { base: BASE, engine: ENGINE, userAgent: null, scenarios: [], errors: [] };

function fail(scenario, message) {
  result.errors.push(`[${scenario}] ${message}`);
}

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 1,
      isMobile: !!scenario.mobile,
      hasTouch: !!scenario.mobile,
      reducedMotion: "reduce",
    });
    await context.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    await context.addInitScript(() => localStorage.setItem("thalamus-motion", "reduced"));
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    result.userAgent ??= await page.evaluate(() => navigator.userAgent);

    const state = await page.evaluate(() => {
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const overlaps = (a, b) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const visible = (selector) => [...document.querySelectorAll(selector)].every((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      });
      const final = document.getElementById("grow-final");
      const finalRect = final ? rect(final) : null;
      const chipOverlaps = finalRect
        ? [...document.querySelectorAll(".js-chip")]
          .filter((chip) => overlaps(finalRect, rect(chip)))
          .map((chip) => chip.textContent?.trim() ?? "unknown")
        : ["missing closing statement"];
      const alivePayoff = document.getElementById("alive-payoff");
      const alivePieces = alivePayoff
        ? [...alivePayoff.querySelectorAll(".payoff-label, .payoff-bar")].map(rect)
        : [];
      const aliveOverlaps = alivePieces.length
        ? [...document.querySelectorAll(".js-source, .js-queued, .js-engine")]
          .filter((node) => alivePieces.some((piece) => overlaps(piece, rect(node))))
          .map((node) => node.textContent?.trim().replace(/\s+/g, " ") ?? "unknown")
        : ["missing payoff"];
      return {
        htmlClasses: [...document.documentElement.classList],
        label: document.getElementById("motion-control-label")?.textContent?.trim(),
        growCount: document.getElementById("grow-count")?.textContent?.trim(),
        chipOverlaps,
        aliveOverlaps,
        activeAnimations: document.getAnimations().filter((animation) => animation.playState === "running").length,
        anatomyVisible: visible(".an-copy"),
        aliveVisible: visible(".js-source, .js-engine, #alive-payoff, .js-tick"),
        pluginsVisible: visible(".js-chip, .js-cmd, #grow-final"),
        kernelVisible: visible(".js-layer, .js-noun"),
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });

    if (state.htmlClasses.includes("motion") || state.htmlClasses.includes("anatomy-motion")) {
      fail(scenario.name, `motion classes present: ${state.htmlClasses.join(" ")}`);
    }
    if (state.label !== "Play full motion") fail(scenario.name, `motion control says ${state.label}`);
    if (state.growCount !== "Plugins installed · 12") fail(scenario.name, `plugin frame says ${state.growCount}`);
    if (state.chipOverlaps.length) fail(scenario.name, `plugin payoff overlaps ${state.chipOverlaps.join(", ")}`);
    if (state.aliveOverlaps.length) fail(scenario.name, `always-on payoff overlaps ${state.aliveOverlaps.join(", ")}`);
    if (state.activeAnimations) fail(scenario.name, `${state.activeAnimations} animations still running`);
    for (const key of ["anatomyVisible", "aliveVisible", "pluginsVisible", "kernelVisible"]) {
      if (!state[key]) fail(scenario.name, `${key.replace("Visible", "")} content hidden`);
    }
    if (state.horizontalOverflow) fail(scenario.name, `${state.horizontalOverflow}px horizontal overflow`);
    for (const error of pageErrors) fail(scenario.name, `page error: ${error}`);
    for (const error of consoleErrors) fail(scenario.name, `console error: ${error}`);

    for (const [name, selector] of Object.entries(frames)) {
      const frame = page.locator(selector).first();
      await frame.screenshot({ path: path.join(OUT, `${scenario.name}-${name}-section.png`) });
      await frame.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUT, `${scenario.name}-${name}-viewport.png`) });
    }

    result.scenarios.push({
      name: scenario.name,
      viewport: `${scenario.width}x${scenario.height}`,
      state,
      pageErrors,
      consoleErrors,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
}

if (result.errors.length) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}
console.log(`${result.scenarios.length} static showcase scenarios passed`);
