/**
 * The scroll engine for the three pinned beats.
 *
 * ## Why this is not the prototype's implementation
 *
 * The design prototype re-measured every element with `getBoundingClientRect()`
 * on every `scroll` event — roughly 40 forced synchronous layouts per frame,
 * per beat. That is the classic layout-thrash pattern and it shows up directly
 * as INP and dropped frames. This version:
 *
 *   1. Measures **only on resize**, into a cached layout table.
 *   2. Derives scroll progress from `scrollY` against cached `offsetTop` /
 *      `offsetHeight`, so the hot path reads no geometry at all.
 *   3. Coalesces every scroll event into one `requestAnimationFrame` tick.
 *   4. Runs only the beats currently intersecting the viewport.
 *   5. Precomputes each SVG path into a sampled point table, so the signal dots
 *      never call `getPointAtLength()` during a frame.
 *   6. Writes only `opacity` and `transform` — both compositor properties.
 *
 * ## Why motion is opt-in
 *
 * The CSS resting state is the *fully composed* frame: everything visible, in
 * normal flow. This module adds `motion` to <html> and `pin--motion` to each
 * pin only after confirming it can actually drive them. If the script never
 * loads, throws, or the device is a phone, the visitor still sees complete
 * content — as does any crawler that does not execute JavaScript.
 *
 * That ordering is deliberate and hard-won: the previous version of this site
 * hid content in CSS and relied on JS to reveal it, and shipped blank sections
 * twice when the observer never fired.
 */

/*
 * Motion runs at every size. It used to be gated behind
 * `(min-width: 900px) and (min-height: 600px)`, which meant every phone and
 * tablet got a static document — the beats were the page's whole argument and
 * they simply did not happen on the primary device.
 *
 * Phones do not get the desktop choreography shrunk, though. The wide
 * compositions (left rail → relay → right rail, radial plugin constellation)
 * reflow to vertical stacks below 860px, so their spatial motion — absorbing
 * chips toward a centre, strokes drawn between fixed points — has nothing to
 * describe. Compact mode drives the same elements as a downward cascade
 * instead: the thing a thumb is already doing.
 *
 * `prefers-reduced-motion` remains the default blocker. A visitor can make an
 * explicit site-level choice with the visible motion control.
 */
const COMPACT_QUERY = "(max-width: 860px)";
const SHORT_QUERY = "(max-height: 500px)";
const LANDSCAPE_QUERY = "(orientation: landscape)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Samples per path for the precomputed point table. */
const PATH_SAMPLES = 96;

interface Pt {
  x: number;
  y: number;
}

interface PathRig {
  el: SVGPathElement;
  len: number;
  pts: Pt[];
}

interface NodeRig {
  el: HTMLElement;
  inner: HTMLElement;
  /** Percent coordinates within the field, read once from --x / --y. */
  x: number;
  y: number;
}

interface Beat {
  key: "alive" | "grow" | "kernel";
  pin: HTMLElement;
  top: number;
  bottom: number;
  span: number;
  active: boolean;
  frame: (p: number) => void;
  /** Reads geometry into the beat's cache. Cheap to call, never on scroll. */
  measure?: () => void;
  /** Geometry is only trustworthy once the beat has been laid out on screen. */
  measured: boolean;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => t * (2 - t);

const num = (el: HTMLElement, prop: string, fallback: number): number => {
  const raw = el.style.getPropertyValue(prop).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** Portrait uses `--mx`/`--my`; landscape/desktop uses `--x`/`--y`. */
const rig = (el: HTMLElement, compact = false): NodeRig => ({
  el,
  inner: el.firstElementChild as HTMLElement,
  x: num(el, compact ? "--mx" : "--x", 50),
  y: num(el, compact ? "--my" : "--y", 50),
});

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

export function initBeats(): void {
  const compactMQ = window.matchMedia(COMPACT_QUERY);
  const shortMQ = window.matchMedia(SHORT_QUERY);
  const landscapeMQ = window.matchMedia(LANDSCAPE_QUERY);
  const reducedMQ = window.matchMedia(REDUCED_QUERY);

  const pins = $(".pin");
  if (!pins.length) return;

  let engine: Engine | null = null;
  let engineCompact = false;

  const sync = () => {
    const forced = document.documentElement.dataset.motion;
    const wanted = forced === "full" || (forced !== "reduced" && !reducedMQ.matches);
    // A short landscape phone has the horizontal room for the desktop
    // constellation even though its width falls just below the portrait
    // breakpoint. Keeping portrait geometry there crowds the centre while
    // wasting both sides of the screen.
    const shortLandscape = shortMQ.matches && landscapeMQ.matches;
    const compact = compactMQ.matches && !shortLandscape;
    // Crossing the breakpoint swaps choreography, so the old one is torn down
    // and its inline styles handed back to CSS first.
    if (engine && (!wanted || compact !== engineCompact)) {
      engine.destroy();
      engine = null;
    }
    if (wanted && !engine) {
      engine = start(pins, compact);
      engineCompact = compact;
    }
    // Reduced motion on a wide screen still gets the constellation, so draw its
    // routing strokes once, at rest. They are the diagram's whole argument —
    // without them it is a scatter of labels — and a static line is not motion.
    if (!wanted && !compact) paintStaticPaths();
  };

  sync();
  const listen = (query: MediaQueryList) => {
    if (typeof query.addEventListener === "function") query.addEventListener("change", sync);
    else query.addListener(sync);
  };
  listen(compactMQ);
  listen(shortMQ);
  listen(landscapeMQ);
  listen(reducedMQ);

  // The running engine handles its own resizes. This covers the static path:
  // percentage-positioned nodes move when the window does, so the strokes
  // between them have to be redrawn.
  let t: number | undefined;
  window.addEventListener("resize", () => {
    if (engine) return;
    window.clearTimeout(t);
    t = window.setTimeout(sync, 150);
  });
}

interface Engine {
  destroy(): void;
}

function start(pins: HTMLElement[], compact = false): Engine {
  const doc = document.documentElement;
  doc.classList.add("motion");
  doc.classList.toggle("motion-compact", compact);
  pins.forEach((p) => p.classList.add("pin--motion"));

  const beats: Beat[] = [];
  const cleanups: Array<() => void> = [];

  // ── Beat 2 · signals route through the relay and fan out to engines ──
  const aliveField = document.getElementById("alive-diagram");
  if (aliveField) {
    const sources = $(".js-source").map((el) => rig(el, compact));
    const engines = $(".js-engine").map((el) => rig(el, compact));
    const queued = $(".js-queued").map((el) => rig(el, compact));
    const ticks = $(".js-tick");
    const payoff = document.getElementById("alive-payoff");
    const ticker = document.getElementById("alive-ticker");
    const paths: PathRig[] = buildRelayPaths(aliveField, sources.length + engines.length);
    const dots = $<SVGCircleElement>("#alive-svg circle");

    let fw = 0;
    let fh = 0;
    let settleY = 0;

    const measure = () => {
      const r = aliveField.getBoundingClientRect();
      fw = r.width;
      fh = r.height;
      // The ticker fades but keeps its box, which left the node sitting high
      // with a third of the stage empty beneath it. Sliding the diagram down by
      // half the vacated height re-centres the closing frame. A transform, so
      // nothing reflows.
      const t = ticker?.getBoundingClientRect().height ?? 0;
      settleY = t ? (t + 16) / 2 : 0;
      layoutRelayPaths(aliveField, paths, sources, engines, compact);
    };

    // Absorption: as the beat resolves, every chip travels into the relay node
    // and shrinks, so the payoff frame reads as "all of this became one thing".
    const absorb = (n: NodeRig, opacity: number, fade: number) => {
      n.el.style.opacity = String(opacity);
      if (!n.inner) return;
      const k = 0.85 * (1 - fade);
      const dx = (((50 - n.x) / 100) * fw * k).toFixed(1);
      const dy = (((50 - n.y) / 100) * fh * k).toFixed(1);
      const s = (1 - 0.35 * (1 - fade)).toFixed(3);
      n.inner.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    };

    const frame = (p: number) => {
      const fade = 1 - seg(p, 0.8, 0.9);

      sources.forEach((n, i) => absorb(n, ease(seg(p, 0.04 + i * 0.05, 0.2 + i * 0.05)) * fade, fade));
      queued.forEach((n, i) =>
        absorb(n, ease(seg(p, 0.12 + i * 0.06, 0.28 + i * 0.06)) * 0.55 * fade, fade),
      );

      paths.forEach((path, i) => {
        const inbound = i < sources.length;
        const startAt = inbound ? 0.1 + i * 0.055 : 0.36 + (i - sources.length) * 0.055;
        const t = ease(seg(p, startAt, startAt + 0.16));

        /*
         * Retraction. The chips absorb into the node by transform, but the
         * strokes stayed anchored where the chips used to be — so the closing
         * frame had lines hanging in empty space, running off past the diagram
         * edges. They now withdraw into the node instead.
         *
         * Direction matters. With `stroke-dasharray: len`, a positive offset
         * un-draws from the path's END and a negative one from its START.
         * Inbound paths run source → node, so they retract with a negative
         * offset (the source end travels inward); outbound run node → engine,
         * so they retract positive. Both ends therefore move toward the centre,
         * which is what "collapse back in on themselves" has to look like.
         *
         * Leads the fade slightly so the movement is legible before the opacity
         * takes the stroke away.
         */
        const retract = ease(seg(p, 0.76 + i * 0.012, 0.89 + i * 0.012));
        const drawn = path.len * (1 - t);
        const pull = path.len * retract * (inbound ? -1 : 1);
        path.el.style.strokeDashoffset = String(drawn + pull);
        path.el.style.opacity = String(fade);

        const dot = dots[i];
        if (dot && path.pts.length) {
          const pt = path.pts[Math.min(path.pts.length - 1, Math.round(t * (path.pts.length - 1)))];
          dot.setAttribute("cx", pt.x.toFixed(1));
          dot.setAttribute("cy", pt.y.toFixed(1));
          // The signal has arrived by the time the line withdraws.
          dot.style.opacity = String((t > 0.03 && t < 0.97 ? 1 : 0) * fade * (1 - retract));
        }
      });

      engines.forEach((n, i) => {
        absorb(n, ease(seg(p, 0.3 + i * 0.04, 0.46 + i * 0.04)) * fade, fade);
        const running = seg(p, 0.4 + i * 0.055, 0.56 + i * 0.055) > 0.6;
        const state = n.el.querySelector<HTMLElement>(".engine-state");
        if (state && state.dataset.running !== String(running)) {
          state.dataset.running = String(running);
          state.textContent = running ? "● running" : "idle";
          state.style.color = running ? "#e4e4e4" : "";
          if (n.inner) n.inner.style.borderColor = running ? "rgba(255,255,255,0.34)" : "";
        }
      });

      ticks.forEach((el, i) => {
        const t = ease(seg(p, 0.46 + i * 0.06, 0.6 + i * 0.06));
        el.style.opacity = String(t * fade);
        el.style.transform = `translate(${((1 - t) * -8).toFixed(1)}px, ${((1 - fade) * 12).toFixed(1)}px)`;
      });

      if (compact) {
        // The payoff sits exactly where the node is, so the node and its label
        // clear just before it lands and one becomes the other.
        const clear = String(1 - seg(p, 0.86, 0.94));
        const node = aliveField.querySelector<HTMLElement>(".core");
        const label = aliveField.querySelector<HTMLElement>(".core-label");
        if (node) node.style.opacity = clear;
        if (label) label.style.opacity = clear;
      } else {
        // Landscape keeps the node and drops the payoff below it, so the
        // diagram slides into the space the faded ticker has vacated.
        const settle = ease(seg(p, 0.8, 0.93));
        aliveField.style.transform = settleY ? `translateY(${(settleY * settle).toFixed(1)}px)` : "";
      }

      if (payoff) payoff.style.opacity = String(seg(p, 0.88, 0.97));
    };

    beats.push(makeBeat("alive", pins, frame, measure));
  }

  // ── Beat 3 · a fresh install grows into a full system, then folds back ──
  const growField = document.getElementById("grow-field");
  if (growField) {
    const chips = $(".js-chip").map((el) => rig(el, compact));
    const cmds = $(".js-cmd");
    const labels = $(".js-grow-label");
    const counter = document.getElementById("grow-count");
    const term = document.getElementById("grow-term");
    const head = document.getElementById("grow-head");
    const core = document.getElementById("grow-core");
    const mark = document.getElementById("grow-mark");
    const final = document.getElementById("grow-final");
    const paths = buildGrowPaths(growField, chips.length);
    const WSTART = [0.04, 0.22, 0.4, 0.55];

    let fw = 0;
    let fh = 0;
    let lastCount = -1;

    const measure = () => {
      const r = growField.getBoundingClientRect();
      fw = r.width;
      fh = r.height;
      layoutGrowPaths(growField, paths, chips);
    };

    const frame = (p: number) => {
      let count = 0;

      chips.forEach((n, ci) => {
        const wave = Number(n.el.dataset.wave ?? 0);
        const k = Number(n.el.dataset.k ?? 0);
        const startAt = WSTART[wave] + 0.03 + k * 0.04;
        const t = ease(seg(p, startAt, startAt + 0.1));
        const clOff = ((ci * 5) % 11) * 0.007;
        const cl = ease(seg(p, 0.8 + clOff, 0.9 + clOff));
        if (t > 0.6) count++;

        const reach = t * (1 - cl);
        n.el.style.opacity = String(reach);
        if (n.inner) {
          const kk = 0.55 * (1 - reach);
          const dx = (((50 - n.x) / 100) * fw * kk).toFixed(1);
          const dy = (((50 - n.y) / 100) * fh * kk).toFixed(1);
          n.inner.style.transform = `translate(${dx}px, ${dy}px) scale(${(0.82 + 0.18 * reach).toFixed(3)})`;
        }

        const path = paths[ci];
        if (path) {
          const lt = ease(seg(p, startAt - 0.02, startAt + 0.07)) * (1 - cl);
          path.el.style.strokeDashoffset = String(path.len * (1 - lt));
          path.el.style.opacity = lt > 0.01 ? "1" : "0";
        }
      });

      let cur = -1;
      cmds.forEach((el, i) => {
        if (p >= Number(el.dataset.at ?? 0)) cur = i;
      });
      cmds.forEach((el, i) => {
        const at = Number(el.dataset.at ?? 0);
        const on = seg(p, at, at + 0.04);
        el.style.opacity = String(on * (i === cur ? 1 : 0.45));
        const caret = el.querySelector<HTMLElement>(".grow-caret");
        if (caret) caret.style.opacity = on > 0.9 && i === cur ? "1" : "0";
      });

      labels.forEach((el, i) => {
        const inO = seg(p, WSTART[i] - 0.02, WSTART[i] + 0.04);
        const outO = i === labels.length - 1 ? 0 : seg(p, WSTART[i + 1] - 0.05, WSTART[i + 1] + 0.01);
        el.style.opacity = String(inO * (1 - outO));
      });

      if (counter && count !== lastCount) {
        lastCount = count;
        counter.textContent = `Plugins installed · ${count}`;
      }

      // The fold: chrome recedes, the system becomes the mark, the line lands.
      if (term) term.style.opacity = String(1 - seg(p, 0.8, 0.87));
      if (head) head.style.opacity = String(1 - seg(p, 0.78, 0.86));
      if (core) core.style.opacity = String(1 - seg(p, 0.88, 0.94));
      if (mark) {
        const mo = seg(p, 0.87, 0.95);
        mark.style.opacity = String(mo);
        mark.style.transform = `translate(-50%, -50%) scale(${(0.55 + 0.45 * ease(mo)).toFixed(3)})`;
      }
      if (final) {
        const fo = seg(p, 0.92, 0.99);
        final.style.opacity = String(fo);
        final.style.transform = `translateX(-50%) translateY(${((1 - fo) * 8).toFixed(1)}px)`;
      }
    };

    beats.push(makeBeat("grow", pins, frame, measure));
  }

  // ── Beat 4 · the layers stack, then the kernel boots its ten nouns ──
  const stack = document.getElementById("kernel-stack");
  if (stack) {
    const layers = $(".js-layer", stack);
    const nouns = $(".js-noun", stack);

    const frame = (p: number) => {
      layers.forEach((el, i) => {
        const t = ease(seg(p, 0.04 + i * 0.09, 0.3 + i * 0.09));
        el.style.opacity = String(t);
        el.style.transform = `translateY(${((1 - t) * (i % 2 ? 22 : -22)).toFixed(1)}px)`;
        // The UI fill recedes as we reach bedrock; the hairline stays.
        const solid = 1 - seg(p, 0.58, 0.8);
        el.style.background = el.classList.contains("layer--kernel")
          ? `rgba(255,255,255,${(0.014 + 0.02 * (1 - solid)).toFixed(3)})`
          : `rgba(19,19,19,${solid.toFixed(3)})`;
      });
      nouns.forEach((el, i) => {
        el.style.opacity = String(ease(seg(p, 0.56 + i * 0.024, 0.64 + i * 0.024)));
      });
    };

    beats.push(makeBeat("kernel", pins, frame));
  }

  if (!beats.length) {
    doc.classList.remove("motion");
    doc.classList.remove("motion-compact");
    pins.forEach((p) => p.classList.remove("pin--motion"));
    return { destroy() {} };
  }

  // ── Measurement: cached, and refreshed only when geometry can have changed ──
  //
  // Pin offsets are safe to read at any time. The *contents* of a beat are not:
  // a sticky stage that has never been on screen can report a zero-sized box, so
  // its own measure() is deferred until it first becomes active.
  const measurePins = () => {
    for (const b of beats) {
      b.top = b.pin.offsetTop;
      /*
       * Sticky travel is the pin minus the STAGE, not minus the viewport.
       *
       * The stage is `100svh` — the *small* viewport, which never changes.
       * `window.innerHeight` is the dynamic one: on iOS it grows ~60px the
       * moment the URL bar collapses on the first downward flick, fires
       * `resize`, and after the debounce every beat's progress mapping shifts
       * mid-scrub. Measuring the element we actually pinned makes bar collapse
       * a no-op.
       */
      const stage = b.pin.firstElementChild as HTMLElement | null;
      const travel = b.pin.offsetHeight - (stage?.offsetHeight ?? window.innerHeight);
      b.span = Math.max(1, travel);
      b.bottom = b.top + b.pin.offsetHeight;
    }
  };

  const measureBeat = (b: Beat) => {
    b.measure?.();
    b.measured = true;
  };

  const measureAll = () => {
    measurePins();
    // Re-measure what is on screen now; the rest re-measures when it arrives.
    for (const b of beats) {
      if (b.active) measureBeat(b);
      else b.measured = false;
    }
  };

  // ── The hot path: one rAF per scroll burst, no geometry reads ──
  let ticking = false;
  const render = () => {
    ticking = false;
    const y = window.scrollY;
    for (const b of beats) {
      if (!b.active) continue;
      b.frame(clamp01((y - b.top) / b.span));
    }
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(render);
  };

  const setActive = (beat: Beat, active: boolean, before: boolean) => {
    beat.active = active;
    if (active) {
      // First time on screen is the first time its geometry is real.
      if (!beat.measured) measureBeat(beat);
    } else {
      beat.frame(before ? 0 : 1);
    }
  };

  /*
   * IntersectionObserver is a performance hint, not a correctness
   * dependency. Older Chrome builds and some privacy tooling omit or stall it.
   * Until the first real callback proves the observer works, cached pin bounds
   * keep the same near-viewport activation contract alive.
   */
  let observerResponded = false;
  let io: IntersectionObserver | null = null;
  const syncActiveFromScroll = () => {
    const margin = window.innerHeight * 0.2;
    const viewportTop = window.scrollY - margin;
    const viewportBottom = window.scrollY + window.innerHeight + margin;
    for (const beat of beats) {
      const active = beat.bottom >= viewportTop && beat.top <= viewportBottom;
      if (active !== beat.active) setActive(beat, active, beat.top > viewportBottom);
    }
  };

  if (typeof window.IntersectionObserver === "function") {
    try {
      io = new window.IntersectionObserver(
        (entries) => {
          observerResponded = true;
          for (const entry of entries) {
            const beat = beats.find((candidate) => candidate.pin === entry.target);
            if (!beat) continue;
            setActive(beat, entry.isIntersecting, entry.boundingClientRect.top > 0);
          }
          onScroll();
        },
        { rootMargin: "20% 0px 20% 0px" },
      );
      beats.forEach((beat) => io?.observe(beat.pin));
    } catch {
      io?.disconnect();
      io = null;
    }
  }

  const onWindowScroll = () => {
    if (!observerResponded) syncActiveFromScroll();
    onScroll();
  };

  // Resize can change every cached number, so re-measure and repaint. Debounced
  // because a desktop window drag fires this continuously.
  let resizeTimer: number | undefined;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measureAll();
      render();
    }, 120);
  };

  measureAll();
  syncActiveFromScroll();
  render();

  window.addEventListener("scroll", onWindowScroll, { passive: true });
  window.addEventListener("resize", onResize);
  // Late-loading fonts shift layout; re-measure once they settle.
  if (document.fonts?.ready) document.fonts.ready.then(measureAll).catch(() => {});

  cleanups.push(() => {
    window.removeEventListener("scroll", onWindowScroll);
    window.removeEventListener("resize", onResize);
    io?.disconnect();
    window.clearTimeout(resizeTimer);
  });

  return {
    destroy() {
      for (const c of cleanups) c();
      doc.classList.remove("motion");
      doc.classList.remove("motion-compact");
      pins.forEach((p) => p.classList.remove("pin--motion"));
      // Hand every element back to CSS so the static composition takes over.
      for (const el of $("[style]", document.getElementById("beats") ?? document)) {
        el.style.removeProperty("opacity");
        el.style.removeProperty("transform");
        el.style.removeProperty("background");
      }
    },
  };
}

/**
 * Draws both diagrams' strokes once, fully extended, for the no-motion path.
 * Idempotent: re-running after a resize just re-lays out the same elements.
 */
function paintStaticPaths(): void {
  const alive = document.getElementById("alive-diagram");
  if (alive) {
    const sources = $(".js-source").map((el) => rig(el));
    const engines = $(".js-engine").map((el) => rig(el));
    const existing = $<SVGPathElement>("#alive-paths path").map((el) => ({
      el,
      len: 0,
      pts: [] as Pt[],
    }));
    const rigs = existing.length ? existing : buildRelayPaths(alive, sources.length + engines.length);
    layoutRelayPaths(alive, rigs, sources, engines);
    for (const p of rigs) {
      p.el.style.strokeDashoffset = "0";
      p.el.style.opacity = "1";
    }
  }

  const grow = document.getElementById("grow-field");
  if (grow) {
    const chips = $(".js-chip").map((el) => rig(el));
    const existing = $<SVGPathElement>("#grow-lines path").map((el) => ({
      el,
      len: 0,
      pts: [] as Pt[],
    }));
    const rigs = existing.length ? existing : buildGrowPaths(grow, chips.length);
    layoutGrowPaths(grow, rigs, chips);
    for (const p of rigs) {
      p.el.style.strokeDashoffset = "0";
      p.el.style.opacity = "1";
    }
  }
}


/** Wires a frame function to its pin, carrying an optional measure step. */
function makeBeat(
  key: Beat["key"],
  pins: HTMLElement[],
  frame: (p: number) => void,
  measure?: () => void,
): Beat {
  const pin = pins.find((p) => p.dataset.beat === key)!;
  return { key, pin, top: 0, bottom: 0, span: 1, active: false, measured: false, frame, measure };
}

/* ---------------------------------------------------------------------- *
 * SVG rigging
 *
 * Strokes are decoration drawn from live element rects, so 1px is 1px at any
 * viewport. Each path is sampled into a point table at layout time so the
 * signal dots can be positioned by array lookup instead of geometry queries.
 * ---------------------------------------------------------------------- */

const NS = "http://www.w3.org/2000/svg";

function sample(el: SVGPathElement, len: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const p = el.getPointAtLength((i / PATH_SAMPLES) * len);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

function buildRelayPaths(field: HTMLElement, count: number): PathRig[] {
  const g = field.querySelector("#alive-paths");
  if (!g) return [];
  const out: PathRig[] = [];
  for (let i = 0; i < count; i++) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "rgba(255,255,255,0.34)");
    p.setAttribute("stroke-width", "1.25");
    p.setAttribute("stroke-linecap", "round");
    g.appendChild(p);

    const c = document.createElementNS(NS, "circle"); // the signal itself
    c.setAttribute("r", "2.6");
    c.setAttribute("fill", "#f2f2f2");
    c.style.opacity = "0";
    g.appendChild(c);

    out.push({ el: p, len: 0, pts: [] });
  }
  return out;
}

function layoutRelayPaths(
  field: HTMLElement,
  paths: PathRig[],
  sources: NodeRig[],
  engines: NodeRig[],
  compact = false,
): void {
  const fr = field.getBoundingClientRect();
  if (!fr.width) return;
  const cx = fr.width / 2;
  const cy = fr.height / 2;

  const rel = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      l: r.left - fr.left,
      r: r.right - fr.left,
      m: r.top - fr.top + r.height / 2,
      c: r.left - fr.left + r.width / 2,
      t: r.top - fr.top,
      b: r.bottom - fr.top,
    };
  };

  // Landscape routes across the screen; portrait routes down it. Same curve,
  // rotated: the control points travel along the axis of the journey.
  const hcurve = (x1: number, y1: number, x2: number, y2: number) => {
    const m = x1 + (x2 - x1) * 0.5;
    return `M${x1} ${y1} C${m} ${y1},${m} ${y2},${x2} ${y2}`;
  };
  const vcurve = (x1: number, y1: number, x2: number, y2: number) => {
    const m = y1 + (y2 - y1) * 0.5;
    return `M${x1} ${y1} C${x1} ${m},${x2} ${m},${x2} ${y2}`;
  };

  sources.forEach((n, i) => {
    const path = paths[i];
    if (!path) return;
    const b = rel(n.el);
    path.el.setAttribute(
      "d",
      compact ? vcurve(b.c, b.b + 8, cx, cy - 26) : hcurve(b.r + 10, b.m, cx - 34, cy),
    );
  });

  engines.forEach((n, i) => {
    const path = paths[sources.length + i];
    if (!path) return;
    const b = rel(n.el);
    path.el.setAttribute(
      "d",
      compact ? vcurve(cx, cy + 26, b.c, b.t - 8) : hcurve(cx + 34, cy, b.l - 10, b.m),
    );
  });

  for (const path of paths) {
    path.len = path.el.getTotalLength();
    path.el.style.strokeDasharray = String(path.len);
    path.pts = sample(path.el, path.len);
  }
}

function buildGrowPaths(field: HTMLElement, count: number): PathRig[] {
  const g = field.querySelector("#grow-lines");
  if (!g) return [];
  const out: PathRig[] = [];
  for (let i = 0; i < count; i++) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "rgba(255,255,255,0.2)");
    p.setAttribute("stroke-width", "1");
    p.style.opacity = "0";
    g.appendChild(p);
    out.push({ el: p, len: 0, pts: [] });
  }
  return out;
}

function layoutGrowPaths(field: HTMLElement, paths: PathRig[], chips: NodeRig[]): void {
  const fr = field.getBoundingClientRect();
  if (!fr.width) return;
  const cx = fr.width / 2;
  const cy = fr.height / 2;

  chips.forEach((n, i) => {
    const path = paths[i];
    if (!path) return;
    const r = n.el.getBoundingClientRect();
    const x = r.left - fr.left + r.width / 2;
    const y = r.top - fr.top + r.height / 2;
    path.el.setAttribute("d", `M${cx.toFixed(1)} ${cy.toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}`);
    path.len = path.el.getTotalLength();
    path.el.style.strokeDasharray = String(path.len);
  });
}
