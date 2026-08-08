/**
 * Cross-engine motion contract.
 *
 * Playwright browsers are installed separately (`npx playwright install`).
 * The default exercises Chromium, Firefox and WebKit; narrow a local run with
 * `BROWSERS=chromium,firefox` when the host cannot launch WebKit.
 *
 *   node scripts/motion-cross-browser.mjs [baseUrl]
 */
import { chromium, firefox, webkit } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4399/";
const available = { chromium, firefox, webkit };
const requested = (process.env.BROWSERS ?? "chromium,firefox,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const scenarios = [
  { name: "desktop", width: 1440, height: 900, motion: true },
  { name: "windows-short", width: 1366, height: 490, motion: true },
  { name: "phone-landscape", width: 844, height: 390, motion: true },
  { name: "large", width: 2560, height: 1440, motion: true },
  { name: "system-reduced", width: 1440, height: 900, motion: false, reduced: true },
  {
    name: "site-paused",
    width: 1440,
    height: 900,
    motion: false,
    override: "reduced",
  },
  {
    name: "system-reduced-override",
    width: 1440,
    height: 900,
    motion: true,
    reduced: true,
    override: "full",
  },
];

const selectors = {
  alive: [".js-source", ".js-engine", ".js-tick"],
  grow: [".js-chip", ".js-grow-label", ".js-cmd", "#grow-final"],
  kernel: [".js-layer", ".js-noun"],
  anatomy: [".an-copy", ".an-callout", ".an-noun", ".an-hand", ".an-payoff"],
};

async function sample(page, pinSelector, targets, progress) {
  return page.evaluate(async ({ pinSelector, targets, progress }) => {
    const pin = document.querySelector(pinSelector);
    const stage = pin?.firstElementChild;
    if (!(pin instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
    const span = Math.max(1, pin.offsetHeight - stage.offsetHeight);
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, pin.offsetTop + span * progress);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return targets
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((element) => {
        const style = getComputedStyle(element);
        return [style.display, style.opacity, style.transform, style.strokeDashoffset].join("|");
      })
      .join(";");
  }, { pinSelector, targets, progress });
}

let passes = 0;
for (const browserName of requested) {
  const browserType = available[browserName];
  if (!browserType) throw new Error(`Unknown browser: ${browserName}`);
  const browser = await browserType.launch({ headless: true });
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        reducedMotion: scenario.reduced ? "reduce" : "no-preference",
      });
      try {
        if (scenario.override) {
          await context.addInitScript(
            (value) => {
              if (!localStorage.getItem("thalamus-motion")) {
                localStorage.setItem("thalamus-motion", value);
              }
            },
            scenario.override,
          );
        }
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);

        const classes = await page.evaluate(() => [...document.documentElement.classList]);
        const motionLabel = await page.locator("#motion-control-label").textContent();
        const expectedLabel = scenario.motion ? "Pause motion" : "Play full motion";
        if (motionLabel !== expectedLabel) {
          throw new Error(`motion control said ${JSON.stringify(motionLabel)}; expected ${expectedLabel}`);
        }
        if (scenario.motion) {
          if (!classes.includes("motion") || !classes.includes("anatomy-motion")) {
            throw new Error(`missing motion classes (${classes.join(" ")})`);
          }
          for (const [key, targets] of Object.entries(selectors)) {
            const pinSelector = key === "anatomy" ? "[data-anatomy]" : `[data-beat="${key}"]`;
            const early = await sample(page, pinSelector, targets, 0.15);
            const late = await sample(page, pinSelector, targets, 0.75);
            if (early === late) throw new Error(`${key} stayed static`);
          }
        } else {
          if (classes.includes("motion") || classes.includes("anatomy-motion")) {
            throw new Error("static mode gained motion classes");
          }
          const visible = await page.evaluate(() =>
            [...document.querySelectorAll(
              ".js-source, .js-engine, .js-chip, .js-layer, .js-noun, .an-copy",
            )].every((element) => {
              const style = getComputedStyle(element);
              return style.display !== "none" && style.opacity !== "0" && style.visibility !== "hidden";
            }),
          );
          if (!visible) throw new Error("static content hidden");

          // Reduced motion is a safe default, not a dead end. The visible
          // control must let a visitor explicitly restore the choreography.
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded" }),
            page.locator("#motion-control").click(),
          ]);
          await page.waitForTimeout(900);
          const restored = await page.evaluate(() => [...document.documentElement.classList]);
          if (!restored.includes("motion") || !restored.includes("anatomy-motion")) {
            throw new Error("motion control did not restore full motion");
          }
        }
        if (errors.length) throw new Error(errors.join(" | "));
        passes++;
        console.log(`ok  ${browserName} · ${scenario.name}`);
      } catch (error) {
        throw new Error(`${browserName}/${scenario.name}: ${error.message}`, { cause: error });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

console.log(`\n${passes} cross-browser scenarios passed`);
