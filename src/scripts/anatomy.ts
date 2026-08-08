/**
 * The dissection — a canvas brain that comes apart as you scroll, leaving the
 * thalamus.
 *
 * Ported from the designer's `thalamus.dev Anatomy.dc.html` and
 * `thalamus.dev Anatomy Mobile.dc.html` (handoff 4). The two files differ only
 * in a handful of constants — camera zoom, projection origin, hand spread,
 * callout label positions and pin length — so they are one engine here with a
 * `compact` parameter set, the same shape `beats.ts` already uses.
 *
 * Three rules this file must not break:
 *
 * 1. **The canvas is decoration.** Nothing an AI crawler or a screen reader
 *    needs is drawn in it. Every word lives in real DOM text, and the CSS
 *    resting state shows all of it. The engine only ever *adds* motion.
 * 2. **Progress is measured against the stage, not the viewport.** iOS
 *    collapses its URL bar mid-scroll, which changes `innerHeight` and would
 *    shift the mapping under the reader's finger. The sticky stage is
 *    `100svh` and stable.
 * 3. **Particles are generated from a seeded PRNG.** Same layout every load,
 *    on every machine — a brain that reshuffled on reload would read as noise.
 */

const COMPACT_QUERY = "(max-width: 860px)";
const TOO_SHORT_QUERY = "(max-height: 500px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

type Vec4 = [number, number, number, number];

interface Params {
  /** Camera keyframes: [progress, centreX, centreY, zoom] in brain space. */
  camera: Vec4[];
  /** Where the four harness cards sit, in brain space. */
  handAnchors: [number, number][];
  /** Callout leaders: [anchorX, anchorY, labelX, labelY]. */
  calloutGeo: Vec4[];
  /** Brain-space → pixel scale, fitted to the stage box. */
  scale: (w: number, h: number) => number;
  /** Projection origin as a fraction of the stage. */
  origin: [number, number];
}

const DESKTOP: Params = {
  camera: [
    [0, 50, 43, 1], [0.44, 50, 43, 1], [0.56, 53.5, 45.5, 2.3],
    [0.63, 53.5, 46.5, 2.2], [0.74, 52, 68, 1.8], [0.84, 52, 88, 1.35], [1, 52, 90, 1.28],
  ],
  handAnchors: [[30, 104], [45, 110], [60, 110], [75, 104]],
  calloutGeo: [[30, 13.5, 17, 5], [80, 64, 92, 72.5], [60.5, 45, 74, 38.5], [52.5, 74, 67, 79]],
  scale: (w, h) => Math.min(w * 0.0082, h * 0.0112),
  origin: [0.585, 0.5],
};

const COMPACT: Params = {
  camera: [
    [0, 50, 43, 1], [0.44, 50, 43, 1], [0.56, 53.5, 45.5, 2],
    [0.63, 53.5, 46.5, 1.92], [0.74, 52, 66, 1.65], [0.84, 52, 87, 1.12], [1, 52, 89, 1.08],
  ],
  /* The designer's mock is a 440px frame, where four cards fit in a shallow
     two-row fan. At 390 and 360 they collide and clip, so the inner pair drops
     a full card-height clear of the outer pair and spreads slightly wider.
     Same fan, same four nerve endpoints — just enough room to land. */
  handAnchors: [[27, 104], [40, 120], [65, 120], [78, 104]],
  calloutGeo: [[30, 13.5, 16, 4], [80, 64, 90, 73], [60.5, 45, 79, 38], [52.5, 74, 70, 79.5]],
  scale: (w, h) => Math.min(w * 0.0102, h * 0.0068),
  origin: [0.5, 0.6],
};

/** Which rail item is lit, by progress range. Desktop only. */
const RAIL_RANGES: [number, number][] = [
  [0, 0.095], [0.095, 0.285], [0.285, 0.445], [0.445, 0.645], [0.645, 0.795], [0.795, 2],
];

interface Particle {
  x: number; y: number;
  region: "cortex" | "cb" | "thal" | "stem";
  dx: number; dy: number;
  r: number; a: number; ph: number; h: number;
  sx: number; sy: number;
}

interface Signal {
  lane: number; ph: number; sp: number; up: boolean; off: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => t * (2 - t);
const easeIO = (t: number) => t * t * (3 - 2 * t);

/** Squared normalised distance inside a rotated ellipse; <= 1 means inside. */
function ell(x: number, y: number, cx: number, cy: number, rx: number, ry: number, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dy = y - cy;
  const u = (c * dx + s * dy) / rx, v = (-s * dx + c * dy) / ry;
  return u * u + v * v;
}

const stemX = (y: number) => {
  const t = (y - 50) / 32;
  return 57 - 7 * t + 1.2 * Math.sin(2.6 * t);
};
const stemPt = (t: number): [number, number] => {
  const y = 50 + 32 * t;
  return [stemX(y), y];
};

/** Seeded LCG — identical particle field on every load. */
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function buildParticles(density: number): Particle[] {
  const R = lcg(77);
  const inThal = (x: number, y: number) => ell(x, y, 54, 45, 7.6, 4.8, -0.18) <= 1;
  const inCb = (x: number, y: number) => ell(x, y, 73, 61, 12, 8, 0.12) <= 1;
  const inStem = (x: number, y: number) =>
    y >= 50 && y <= 82 && Math.abs(x - stemX(y)) <= 3.4 - 1.6 * ((y - 50) / 32) && !inThal(x, y);
  const cerebrumVals = (x: number, y: number) => [
    ell(x, y, 50, 32, 34, 23), ell(x, y, 24, 40, 12, 15),
    ell(x, y, 76, 42, 13, 13), ell(x, y, 42, 52, 18, 11),
  ];
  const inCerebrum = (x: number, y: number) => {
    if (y > 63) return false;
    if (Math.min(...cerebrumVals(x, y)) > 1) return false;
    if (ell(x, y, 54, 45, 12, 8.2) <= 1) return false; // moat around the thalamus
    if (ell(x, y, 73, 61, 13.8, 9.4, 0.12) <= 1) return false; // gap to the cerebellum
    if (y >= 50 && Math.abs(x - stemX(y)) < 4.6) return false;
    return true;
  };
  /* Folds. Without this the cortex is an even wash; with it, gyri. */
  const gyri = (x: number, y: number) =>
    Math.sin(x * 0.52 + 2.6 * Math.sin(y * 0.21 + x * 0.08)) + 0.7 * Math.sin(y * 0.45 + 1.8 * Math.sin(x * 0.13));

  const parts: Particle[] = [];
  const sample = (
    n: number, bx: number, by: number, bw: number, bh: number,
    test: (x: number, y: number) => boolean,
    accept: ((x: number, y: number) => boolean) | null,
    region: Particle["region"], cx: number, cy: number, biasX: number, biasY: number,
  ) => {
    let tries = 0;
    while (n > 0 && tries < n * 220) {
      tries++;
      const x = bx + R() * bw, y = by + R() * bh;
      if (!test(x, y)) continue;
      if (accept && !accept(x, y)) continue;
      const edge = region === "cortex" ? Math.min(...cerebrumVals(x, y)) > 0.86 : false;
      let dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx = dx / len + biasX + (R() - 0.5) * 0.7;
      dy = dy / len + biasY + (R() - 0.5) * 0.7;
      parts.push({
        x, y, region, dx, dy,
        r: 0.26 + R() * 0.34 + (edge ? 0.1 : 0),
        a: (edge ? 0.72 : 0.42) + R() * 0.34,
        ph: R() * 6.28, h: R(),
        sx: (R() - 0.5) * 120, sy: (R() - 0.5) * 90,
      });
      n--;
    }
  };

  const d = density;
  sample(Math.round(2600 * d), 8, 7, 84, 58, inCerebrum, (x, y) => gyri(x, y) > 0.08 || R() < 0.09, "cortex", 50, 38, 0, -0.55);
  sample(Math.round(560 * d), 60, 52, 26, 18, inCb, (x, y) => Math.sin(y * 3.1 + x * 0.4) > 0 || R() < 0.1, "cb", 54, 45, 0.5, 0.35);
  sample(Math.round(320 * d), 46, 40, 17, 11, inThal, null, "thal", 54, 45, 0, 0);
  sample(Math.round(340 * d), 44, 50, 18, 33, inStem, null, "stem", 54, 45, 0, 0);
  /* Silhouette passes — a dense dotted contour so each mass reads at a glance. */
  sample(Math.round(720 * d), 8, 7, 84, 58, inCerebrum, (x, y) => Math.min(...cerebrumVals(x, y)) > 0.86, "cortex", 50, 38, 0, -0.55);
  sample(Math.round(200 * d), 60, 52, 26, 18, inCb, (x, y) => ell(x, y, 73, 61, 12, 8, 0.12) > 0.82, "cb", 54, 45, 0.5, 0.35);
  sample(Math.round(150 * d), 46, 40, 17, 11, inThal, (x, y) => ell(x, y, 54, 45, 7.6, 4.8, -0.18) > 0.74, "thal", 54, 45, 0, 0);
  return parts;
}

function buildSignals(): Signal[] {
  const R = lcg(13);
  const out: Signal[] = [];
  for (let i = 0; i < 9; i++) out.push({ lane: i % 4, ph: R(), sp: 0.1 + R() * 0.05, up: false, off: -0.5 + R() });
  for (let i = 0; i < 5; i++) out.push({ lane: i % 4, ph: R(), sp: 0.07 + R() * 0.04, up: true, off: 0.6 + R() * 0.9 });
  return out;
}

export function initAnatomy(): void {
  const pin = document.querySelector<HTMLElement>("[data-anatomy]");
  const canvas = pin?.querySelector<HTMLCanvasElement>(".an-canvas");
  const stage = pin?.querySelector<HTMLElement>(".an-stage");
  if (!pin || !canvas || !stage) return;

  const reduced = window.matchMedia(REDUCED_QUERY).matches;
  if (reduced) return; // CSS resting state is already the composed plate.

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const copies = Array.from(pin.querySelectorAll<HTMLElement>(".an-copy"));
  const callouts = Array.from(pin.querySelectorAll<HTMLElement>(".an-callout"));
  const nouns = Array.from(pin.querySelectorAll<HTMLElement>(".an-noun"));
  const hands = Array.from(pin.querySelectorAll<HTMLElement>(".an-hand"));
  const rails = Array.from(pin.querySelectorAll<HTMLElement>(".an-rail-item"));
  const caption = pin.querySelector<HTMLElement>(".an-caption");
  const hint = pin.querySelector<HTMLElement>(".an-hint");
  const rail = pin.querySelector<HTMLElement>(".an-rail");
  const payoff = pin.querySelector<HTMLElement>(".an-payoff");

  /* A phone draws the same field into a fraction of the pixels; thinning it
     keeps the frame budget without visibly changing the plate. */
  const compactMQ = window.matchMedia(COMPACT_QUERY);
  const shortMQ = window.matchMedia(TOO_SHORT_QUERY);
  let compact = compactMQ.matches || shortMQ.matches;
  let params = compact ? COMPACT : DESKTOP;
  let parts = buildParticles(compact ? 0.62 : 1);
  const signals = buildSignals();

  /* Motion is opt-in: the class is what switches the CSS from the composed
     resting state to the scrubbed one. Only this engine ever sets it, so a
     script that fails to load leaves a readable page. */
  document.documentElement.classList.add("anatomy-motion");

  let p = 0;
  let span = 1;
  let pinTop = 0;
  let pinBottom = 0;
  let active = false;
  let raf = 0;

  const measure = () => {
    const rect = pin.getBoundingClientRect();
    pinTop = rect.top + window.scrollY;
    pinBottom = pinTop + pin.offsetHeight;
    span = Math.max(1, pin.offsetHeight - stage.offsetHeight);
  };

  const readProgress = () => {
    p = clamp01((window.scrollY - pinTop) / span);
  };

  const frame = (now: number) => {
    raf = 0;
    const t = now / 1000;
    const s = (a: number, b: number) => seg(p, a, b);

    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ── camera ──────────────────────────────────────────────────────────
    const keys = params.camera;
    let a = keys[0], b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (p >= keys[i][0] && p <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
    }
    const ct = easeIO(seg(p, a[0], b[0]));
    const cx = a[1] + (b[1] - a[1]) * ct;
    const cy = a[2] + (b[2] - a[2]) * ct;
    const cz = a[3] + (b[3] - a[3]) * ct;

    const sc = params.scale(W, H) * cz;
    const ox = W * params.origin[0], oy = H * params.origin[1];
    const px = (x: number) => ox + (x - cx) * sc;
    const py = (y: number) => oy + (y - cy) * sc;

    // ── phase envelopes ─────────────────────────────────────────────────
    const assemble = ease(s(0.005, 0.062));
    const calloutA = ease(s(0.05, 0.08)) * (1 - s(0.115, 0.145));
    const f1 = s(0.1, 0.13) * (1 - s(0.255, 0.285));   // cortex in focus
    const f2 = s(0.285, 0.315) * (1 - s(0.4, 0.43));   // cerebellum in focus
    const thalGlow = s(0.43, 0.5);
    const endFade = 1 - s(0.94, 0.985) * 0.85;

    const mul: Record<Particle["region"], number> = {
      cortex: 1 - 0.62 * f2,
      cb: 1 - 0.62 * f1,
      thal: (1 - 0.55 * f1) * (1 - 0.55 * f2) + thalGlow * 0.6,
      stem: (1 - 0.6 * f1) * (1 - 0.6 * f2),
    };

    // ── particles ───────────────────────────────────────────────────────
    ctx.fillStyle = "#f2f2f2";
    for (const q of parts) {
      let gone = 0, gx = 0, gy = 0;
      if (q.region === "cortex") { const st = 0.155 + q.h * 0.055; gone = ease(s(st, st + 0.05)); gx = 30; gy = 26; }
      else if (q.region === "cb") { const st = 0.325 + q.h * 0.05; gone = ease(s(st, st + 0.045)); gx = 26; gy = 22; }
      if (gone >= 1) continue;
      const scatter = 1 - assemble;
      const x = q.x + q.sx * scatter + q.dx * gone * gx;
      const y = q.y + q.sy * scatter + q.dy * gone * gy;
      let al = q.a * assemble * (1 - gone) * mul[q.region] * endFade;
      if (q.region === "cortex") al *= 1 + 0.35 * f1;
      if (q.region === "cb") al *= 1 + 0.35 * f2;
      if (q.region === "thal") al *= 1 + thalGlow * (0.35 + 0.3 * Math.sin(t * 2.1 + q.ph));
      else al *= 0.88 + 0.12 * Math.sin(t * 1.2 + q.ph);
      if (al <= 0.01) continue;
      const X = px(x), Y = py(y);
      if (X < -20 || X > W + 20 || Y < -20 || Y > H + 20) continue;
      ctx.globalAlpha = Math.min(1, al);
      ctx.beginPath();
      ctx.arc(X, Y, Math.max(0.55, q.r * sc * 0.115), 0, 6.2832);
      ctx.fill();
    }

    // ── the thalamus lights up ──────────────────────────────────────────
    if (thalGlow > 0.01) {
      const gx = px(54), gy = py(45), gr = 16 * sc;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, `rgba(242,242,242,${(0.09 * thalGlow * endFade).toFixed(3)})`);
      g.addColorStop(1, "rgba(242,242,242,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = "#f2f2f2";
    }

    // ── anatomical callouts ─────────────────────────────────────────────
    if (calloutA > 0.01) {
      ctx.globalAlpha = calloutA * 0.5;
      ctx.strokeStyle = "#9a9a9a";
      ctx.lineWidth = 1;
      for (const [ax, ay, lx, ly] of params.calloutGeo) {
        ctx.beginPath(); ctx.moveTo(px(ax), py(ay)); ctx.lineTo(px(lx), py(ly)); ctx.stroke();
        ctx.beginPath(); ctx.arc(px(ax), py(ay), 1.6, 0, 6.2832); ctx.fill();
      }
    }
    callouts.forEach((el, i) => {
      const [, , lx, ly] = params.calloutGeo[i];
      el.style.left = `${px(lx)}px`;
      el.style.top = `${py(ly) + (ly < 40 ? -10 : 10)}px`;
      el.style.opacity = String(calloutA);
    });

    // ── nerves reach the harnesses ──────────────────────────────────────
    const nerveA = (1 - s(0.925, 0.965)) * endFade;
    const nervePt = (lane: number, u: number): [number, number] => {
      const S = stemPt(1), E = params.handAnchors[lane];
      const C = [50 + (E[0] - 50) * 0.22, 94];
      const k = 1 - u;
      return [
        k * k * S[0] + 2 * k * u * C[0] + u * u * E[0],
        k * k * S[1] + 2 * k * u * C[1] + u * u * E[1],
      ];
    };
    hands.forEach((el, i) => {
      const draw = ease(s(0.765 + i * 0.014, 0.835 + i * 0.014));
      if (draw > 0.005 && nerveA > 0.01) {
        ctx.globalAlpha = 0.4 * draw * nerveA;
        ctx.strokeStyle = "#c5c5c5";
        ctx.lineWidth = Math.max(1, 0.14 * sc);
        ctx.beginPath();
        const steps = 22;
        for (let k = 0; k <= Math.floor(steps * draw); k++) {
          const [nx, ny] = nervePt(i, k / steps);
          k === 0 ? ctx.moveTo(px(nx), py(ny)) : ctx.lineTo(px(nx), py(ny));
        }
        ctx.stroke();
      }
      const on = ease(s(0.8 + i * 0.016, 0.86 + i * 0.016)) * (1 - s(0.93, 0.96));
      const [hx, hy] = params.handAnchors[i];
      el.style.left = `${px(hx)}px`;
      el.style.top = `${py(hy) + 8}px`;
      el.style.opacity = String(on);
      const running = on > 0.5 && Math.sin(t * 0.85 + i * 1.9) > -0.15;
      const state = el.querySelector<HTMLElement>(".an-hand-state");
      if (state) state.dataset.on = running ? "1" : "0";
      const card = el.firstElementChild as HTMLElement | null;
      if (card) card.dataset.on = running ? "1" : "0";
    });

    // ── traffic on the stem and the nerves ──────────────────────────────
    const sigA = s(0.585, 0.65) * (1 - s(0.93, 0.97)) * endFade;
    const branch = s(0.765, 0.835);
    if (sigA > 0.01) {
      for (const g of signals) {
        const q = (t * g.sp + g.ph) % 1;
        let X: number, Y: number;
        if (g.up) {
          const yy = 100 - q * 50;
          X = px(stemX(yy) + g.off); Y = py(yy);
          ctx.globalAlpha = sigA * 0.4 * Math.min(1, 40 * q * (1 - q));
          ctx.fillStyle = "#8a8a8a";
        } else {
          const split = 0.58;
          if (q < split || branch < 0.5) {
            const [bx, by] = stemPt(branch < 0.5 ? q : Math.min(1, q / split));
            X = px(bx + g.off * 0.6); Y = py(by);
          } else {
            const [bx, by] = nervePt(g.lane, (q - split) / (1 - split));
            X = px(bx); Y = py(by);
          }
          ctx.globalAlpha = sigA * 0.9 * Math.min(1, 40 * q * (1 - q));
          ctx.fillStyle = "#f2f2f2";
        }
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(1.1, 0.11 * sc), 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = "#f2f2f2";
    }
    ctx.globalAlpha = 1;

    // ── the ten kernel nouns ring the thalamus ──────────────────────────
    const nounHold = 1 - s(0.6, 0.635);
    nouns.forEach((el, i) => {
      const ang = (i / nouns.length) * 6.2832 - 1.5708;
      el.style.left = `${px(54 + Math.cos(ang) * (14.5 + (i % 2) * 3.4))}px`;
      el.style.top = `${py(45 + Math.sin(ang) * (10 + (i % 2) * 2.3))}px`;
      el.style.opacity = String(ease(s(0.5 + i * 0.009, 0.555 + i * 0.009)) * nounHold);
    });

    // ── the five copy blocks ────────────────────────────────────────────
    copies.forEach((el) => {
      const [i0, i1] = (el.dataset.in ?? "0,0").split(",").map(Number);
      const [o0, o1] = (el.dataset.out ?? "1,1").split(",").map(Number);
      const inT = ease(s(i0, i1));
      el.style.opacity = String(inT * (1 - s(o0, o1)));
      el.style.setProperty("--an-lift", `${((1 - inT) * 14).toFixed(1)}px`);
    });

    if (caption) caption.style.opacity = String(ease(s(0.03, 0.06)) * (1 - s(0.1, 0.13)));
    if (hint) hint.style.opacity = String(0.85 * (1 - s(0.012, 0.035)));
    if (payoff) {
      const al = ease(s(0.945, 0.985));
      payoff.style.opacity = String(al);
      payoff.style.pointerEvents = al > 0.5 ? "auto" : "none";
    }
    rails.forEach((el, i) => {
      const [r0, r1] = RAIL_RANGES[i];
      el.dataset.on = p >= r0 && p < r1 ? "1" : "0";
    });
    if (rail) rail.style.opacity = String(1 - s(0.94, 0.98));
  };

  const request = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  let observerResponded = false;
  const syncActiveFromScroll = () => {
    const margin = 100;
    active = pinBottom >= window.scrollY - margin
      && pinTop <= window.scrollY + window.innerHeight + margin;
  };

  const onScroll = () => {
    if (!observerResponded) syncActiveFromScroll();
    if (!active) return;
    readProgress();
    request();
  };

  /* Only run the loop while the plate is on screen. A canvas redrawing 4,900
     particles behind the FAQ is pure heat. IntersectionObserver is an
     optimisation only: cached bounds cover browsers where it is missing,
     blocked, or present without ever delivering a callback. */
  if (typeof window.IntersectionObserver === "function") {
    try {
      const io = new window.IntersectionObserver(
        (entries) => {
          observerResponded = true;
          active = entries.some((entry) => entry.isIntersecting);
          if (active) { measure(); readProgress(); request(); }
        },
        { rootMargin: "100px 0px" },
      );
      io.observe(pin);
    } catch {
      // The cached-bounds path below remains active.
    }
  }

  /* The running/waiting flicker on the harness cards is time-driven, not
     scroll-driven, so the loop has to keep ticking while the plate is visible
     even if nobody moves. */
  const tick = () => {
    if (active) request();
    setTimeout(tick, 1000 / 30);
  };
  tick();

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    const nowCompact = compactMQ.matches || shortMQ.matches;
    if (nowCompact !== compact) {
      compact = nowCompact;
      params = compact ? COMPACT : DESKTOP;
      parts = buildParticles(compact ? 0.62 : 1);
    }
    measure();
    if (!observerResponded) syncActiveFromScroll();
    readProgress();
    request();
  });

  measure();
  syncActiveFromScroll();
  readProgress();
  request();
}
