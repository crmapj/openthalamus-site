/**
 * Motion compatibility checks against a running site.
 *
 * The animation engines use IntersectionObserver only as a performance hint.
 * Browsers that omit it, block it, or never deliver its first callback must
 * still drive the same scroll choreography. Reduced-motion stays static.
 *
 *   node scripts/motion-compat.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:4399/";
const PORT = 9344;
const PROFILE = new URL("../.qa-profile-motion-compat/", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarios = [
  { name: "normal Chrome", init: "", motion: true },
  {
    name: "Chrome without IntersectionObserver",
    init: 'Object.defineProperty(window,"IntersectionObserver",{value:undefined,configurable:true});',
    motion: true,
  },
  {
    name: "Chrome with a stalled IntersectionObserver",
    init: `
      class StalledIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      }
      Object.defineProperty(window, "IntersectionObserver", {
        value: StalledIntersectionObserver,
        configurable: true,
      });
    `,
    motion: true,
  },
  {
    name: "Chrome with a throwing IntersectionObserver",
    init: `
      class ThrowingIntersectionObserver {
        constructor() { throw new Error("observer unavailable"); }
      }
      Object.defineProperty(window, "IntersectionObserver", {
        value: ThrowingIntersectionObserver,
        configurable: true,
      });
    `,
    motion: true,
  },
  {
    name: "Chrome with legacy media-query listeners",
    init: `
      Object.defineProperty(MediaQueryList.prototype, "addEventListener", {
        value: undefined,
        configurable: true,
      });
    `,
    motion: true,
  },
  { name: "reduced motion", init: "", motion: false, reduced: true },
];

let passes = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passes++;
    console.log(`  ok    ${name}`);
    return;
  }
  const message = `${name}${detail ? ` — ${detail}` : ""}`;
  failures.push(message);
  console.log(`  FAIL  ${message}`);
}

async function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      message.error
        ? reject(new Error(`${method}: ${message.error.message}`))
        : resolve(message.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function openBrowser(scenario) {
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
  for (let attempt = 0; attempt < 60; attempt++) {
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
  if (!target) {
    chrome.kill();
    throw new Error("Chromium did not expose its debugging target");
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  await cdp(ws, ++id, "Page.enable");
  await cdp(ws, ++id, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (scenario.reduced) {
    await cdp(ws, ++id, "Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  }
  if (scenario.init) {
    await cdp(ws, ++id, "Page.addScriptToEvaluateOnNewDocument", {
      source: scenario.init,
    });
  }
  await cdp(ws, ++id, "Page.navigate", { url: BASE });
  await sleep(1600);

  const evaluate = async (expression) => {
    const result = await cdp(ws, ++id, "Runtime.evaluate", {
      expression: `Promise.resolve((async()=>{ ${expression} })()).then(v=>JSON.stringify(v))`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "browser evaluation failed");
    }
    return JSON.parse(result.result.value);
  };

  return {
    evaluate,
    async close() {
      ws.close();
      chrome.kill();
      await rm(PROFILE, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    },
  };
}

async function inspectMotion(evaluate) {
  return evaluate(`
    const waitForFrame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const styleSignature = (selectors) => selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((element) => {
        const style = getComputedStyle(element);
        return [style.opacity, style.transform, style.strokeDashoffset].join("|");
      })
      .join(";");
    const sample = async (pin, selectors, progress) => {
      const stage = pin.firstElementChild;
      const span = Math.max(1, pin.offsetHeight - (stage?.offsetHeight ?? innerHeight));
      scrollTo({ top: pin.offsetTop + span * progress, behavior: "instant" });
      await waitForFrame();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return styleSignature(selectors);
    };
    const definitions = {
      alive: [".js-source", ".js-engine", ".js-tick"],
      grow: [".js-chip", ".js-grow-label", ".js-cmd", "#grow-final"],
      kernel: [".js-layer", ".js-noun"],
    };
    const beats = {};
    for (const [key, selectors] of Object.entries(definitions)) {
      const pin = document.querySelector('[data-beat="' + key + '"]');
      const early = await sample(pin, selectors, 0.15);
      const late = await sample(pin, selectors, 0.75);
      beats[key] = early !== late;
    }
    const anatomyPin = document.querySelector("[data-anatomy]");
    const anatomySelectors = [".an-copy", ".an-callout", ".an-noun", ".an-hand", ".an-payoff"];
    const anatomyEarly = await sample(anatomyPin, anatomySelectors, 0.15);
    const anatomyLate = await sample(anatomyPin, anatomySelectors, 0.75);
    return {
      classes: document.documentElement.className,
      beats,
      anatomy: anatomyEarly !== anatomyLate,
    };
  `);
}

async function inspectStatic(evaluate) {
  return evaluate(`
    const visible = (selector) => [...document.querySelectorAll(selector)].every((element) => {
      const style = getComputedStyle(element);
      return style.opacity !== "0" && style.visibility !== "hidden";
    });
    return {
      classes: document.documentElement.className,
      pinsStatic: [...document.querySelectorAll(".pin")].every((pin) =>
        !pin.classList.contains("pin--motion") && getComputedStyle(pin).height !== "0px"
      ),
      aliveVisible: visible(".js-source, .js-engine"),
      growVisible: visible(".js-chip"),
      kernelVisible: visible(".js-layer, .js-noun"),
      anatomyVisible: visible(".an-copy"),
    };
  `);
}

for (const scenario of scenarios) {
  console.log(`\n${scenario.name}`);
  const browser = await openBrowser(scenario);
  try {
    if (scenario.motion) {
      const result = await inspectMotion(browser.evaluate);
      check(`${scenario.name}: motion mode enabled`,
        result.classes.includes("motion") && result.classes.includes("anatomy-motion"),
        `classes=${result.classes}`);
      for (const [beat, changed] of Object.entries(result.beats)) {
        check(`${scenario.name}: ${beat} changes across scroll`, changed);
      }
      check(`${scenario.name}: anatomy changes across scroll`, result.anatomy);
    } else {
      const result = await inspectStatic(browser.evaluate);
      check("reduced motion: motion classes absent",
        !result.classes.includes("motion") && !result.classes.includes("anatomy-motion"),
        `classes=${result.classes}`);
      check("reduced motion: pins use the static layout", result.pinsStatic);
      check("reduced motion: alive content visible", result.aliveVisible);
      check("reduced motion: grow content visible", result.growVisible);
      check("reduced motion: kernel content visible", result.kernelVisible);
      check("reduced motion: anatomy copy visible", result.anatomyVisible);
    }
  } finally {
    await browser.close();
  }
}

console.log(`\n${passes} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  · ${failure}`);
  process.exit(1);
}
