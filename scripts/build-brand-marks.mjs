/**
 * Extracts the brand marks the page uses into `src/data/brand-marks.ts`.
 *
 * Why extract rather than import the icon packages from a component: between
 * them they carry ~5,500 icons. Importing either in Astro frontmatter pulls all
 * of them into the build graph to ship ten. This writes a committed data file
 * instead, so the packages stay devDependencies that run once, here.
 *
 * Every mark has TWO variants, because the page needs both:
 *
 *   mono  — one path, `fill: currentColor`. Used in the hero, which stays
 *           monochrome, and as the fallback for any brand with no colour form.
 *   color — the real logo with its own colours baked in. Used on the plugin
 *           chips and the relay engines.
 *
 * A brand only gets a `color` variant when it actually has one. Several of
 * these logos are monochrome black by design — GitHub, Cursor, Ollama,
 * opencode, OpenAI, Attio. Painting them their literal brand hex would render
 * them invisible on a near-black page, and white is what each of those
 * companies' own dark-background guidance specifies. So they fall through to
 * `mono` and inherit the light text colour, which IS their original.
 *
 * Sources, both permissive:
 *   · simple-icons  — CC0. One 24×24 path per brand: the mono variant.
 *   · @iconify-json/logos ("SVG Logos" by Gil Barbara) — CC0. Full-colour,
 *     multi-path: the colour variant.
 *   · scripts/vendor/attio.svg — Attio publish no icon to either set, so their
 *     mark is vendored from their own site. See the note at ATTIO below.
 *
 * Marks are never traced by hand. A from-memory logo is worse than no logo.
 *
 *   node scripts/build-brand-marks.mjs
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import * as si from "simple-icons";
import logos from "@iconify-json/logos/icons.json" with { type: "json" };

/**
 * slug → { mono: simple-icons export, color?: logos icon name, tint?: hex }
 *
 * `tint` paints the mono path a brand colour for a logo that has real chroma
 * but no multi-path colour form in the logos set. Linear is the only one:
 * #5E6AD2 is its brand hex and reads cleanly on dark.
 */
const MARKS = {
  gmail: { mono: "siGmail", color: "google-gmail" },
  calendar: { mono: "siGooglecalendar", color: "google-calendar" },
  linear: { mono: "siLinear", tint: "#5E6AD2" },
  github: { mono: "siGithub" },
  claude: { mono: "siClaude", color: "claude-icon" },
  cursor: { mono: "siCursor" },
  opencode: { mono: "siOpencode" },
  ollama: { mono: "siOllama" },
  gemini: { mono: "siGooglegemini", color: "google-gemini" },
  copilot: { mono: "siGithubcopilot" },
  cline: { mono: "siCline" },
};

/**
 * OpenAI ship no mark to simple-icons — they asked to be removed from it. The
 * logos set carries one under CC0, and using a vendor's mark to state that we
 * work with them is what a compatibility row is for, so Codex is no longer the
 * one engine on the page without a face. Single path, no baked fill, so it
 * takes currentColor and renders white — OpenAI's own dark treatment.
 */
const OPENAI = "openai-icon";

/**
 * Attio publish to neither set. Their mark is vendored from their own site:
 * https://a.storyblok.com/f/234930/18x18/cfb7753a31/attio.svg (fetched
 * 2026-08-07). It is drawn as a stroke rather than a fill — the only mark here
 * that is — so it renders with `stroke: currentColor; fill: none`. Their logo
 * is monochrome, so white on our background is the faithful rendering.
 */
const ATTIO_SVG = new URL("./vendor/attio.svg", import.meta.url);

const iconViewBox = (name) => {
  const icon = logos.icons[name];
  if (!icon) throw new Error(`@iconify-json/logos has no "${name}"`);
  return {
    viewBox: `0 0 ${icon.width ?? logos.width} ${icon.height ?? logos.height}`,
    body: icon.body,
  };
};

const variants = {};

for (const [slug, spec] of Object.entries(MARKS)) {
  const icon = si[spec.mono];
  if (!icon) throw new Error(`simple-icons has no ${spec.mono} — check the export name`);

  const v = { title: icon.title, mono: { viewBox: "0 0 24 24", body: `<path d="${icon.path}"/>` } };

  if (spec.color) v.color = iconViewBox(spec.color);
  else if (spec.tint) {
    v.color = { viewBox: "0 0 24 24", body: `<path fill="${spec.tint}" d="${icon.path}"/>` };
  }
  variants[slug] = v;
}

variants.openai = { title: "OpenAI", mono: iconViewBox(OPENAI) };

// Strip the baked stroke colour so the mark takes currentColor, and drop the
// wrapper — we only want what is inside the <svg>.
const attio = (await readFile(ATTIO_SVG, "utf8"))
  .replace(/[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>[\s\S]*/, "")
  .replace(/\s*stroke="#[0-9a-fA-F]{3,6}"/g, "")
  .replace(/\s+/g, " ")
  .trim();
variants.attio = { title: "Attio", stroke: true, mono: { viewBox: "0 0 18 18", body: attio } };

const lit = (o) => JSON.stringify(o);
const rows = Object.entries(variants).map(
  ([slug, v]) =>
    `  ${slug}: {\n` +
    `    title: ${lit(v.title)},\n` +
    (v.stroke ? `    stroke: true,\n` : "") +
    `    mono: { viewBox: ${lit(v.mono.viewBox)}, body: ${lit(v.mono.body)} },\n` +
    (v.color ? `    color: { viewBox: ${lit(v.color.viewBox)}, body: ${lit(v.color.body)} },\n` : "") +
    `  },`,
);

const out = `/**
 * Brand marks, extracted by \`scripts/build-brand-marks.mjs\`.
 * Do not hand-edit — re-run the script instead.
 *
 * Each mark carries a monochrome variant and, where the brand has one, a
 * full-colour variant. The design doctrine exempts third-party brand logos
 * from the no-colour rule, so the plugin chips and relay engines use \`color\`;
 * the hero deliberately stays monochrome and uses \`mono\`.
 *
 * A missing \`color\` is not an omission. GitHub, Cursor, Ollama, opencode,
 * OpenAI and Attio are monochrome logos whose dark-background form is white —
 * \`mono\` inheriting the light text colour is their original.
 *
 * These are trademarks of their respective owners, used to state compatibility.
 * Sources and licences are documented in the build script.
 */
export interface MarkVariant {
  viewBox: string;
  body: string;
}

export interface BrandMark {
  title: string;
  /** Drawn as a stroke rather than a fill. Attio only. */
  stroke?: boolean;
  mono: MarkVariant;
  color?: MarkVariant;
}

export const brandMarks: Record<string, BrandMark> = {
${rows.join("\n")}
};
`;

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/brand-marks.ts", import.meta.url), out, "utf8");
console.log(
  `brand-marks.ts written: ${Object.keys(variants).length} marks, ` +
    `${Object.values(variants).filter((v) => v.color).length} with a colour variant`,
);
