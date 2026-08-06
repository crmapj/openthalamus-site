/**
 * Extracts the handful of brand marks the page uses into `src/data/brand-marks.ts`.
 *
 * Why extract rather than import `simple-icons` from a component: the package
 * carries ~3,450 icons. Importing it in Astro frontmatter pulls all of them into
 * the build graph to ship nine. This writes a committed data file instead, so
 * `simple-icons` stays a devDependency that runs once, here.
 *
 * Marks are drawn from Simple Icons rather than traced by hand — a
 * from-memory logo is worse than no logo. Two deliberate absences:
 *
 *   · OpenAI  — asked to be removed from Simple Icons. Redrawing their mark is
 *               exactly what that request was about, so Codex is named in text
 *               and carries no glyph.
 *   · Attio   — no mark in the set; the chip stays text-only.
 *
 * The marks are trademarks of their respective owners and are used here only to
 * state compatibility, which is what they are for.
 *
 *   node scripts/build-brand-marks.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import * as si from "simple-icons";

/** slug → the export name in simple-icons. */
const WANTED = {
  gmail: "siGmail",
  calendar: "siGooglecalendar",
  linear: "siLinear",
  github: "siGithub",
  claude: "siClaude",
  cursor: "siCursor",
  opencode: "siOpencode",
  ollama: "siOllama",
  gemini: "siGooglegemini",
};

const rows = [];
for (const [slug, key] of Object.entries(WANTED)) {
  const icon = si[key];
  if (!icon) throw new Error(`simple-icons has no ${key} — check the export name`);
  rows.push(`  ${slug}: {\n    title: ${JSON.stringify(icon.title)},\n    path: ${JSON.stringify(icon.path)},\n  },`);
}

const out = `/**
 * Brand marks, extracted from Simple Icons by \`scripts/build-brand-marks.mjs\`.
 * Do not hand-edit — re-run the script instead.
 *
 * All marks are viewBox "0 0 24 24" and are rendered with \`fill: currentColor\`
 * so they sit inside the monochrome chrome. The design doctrine exempts
 * third-party brand logos from the no-colour rule, but a wall of brand colour
 * would be the loudest thing on the page, and monochrome is the convention for
 * compatibility rows.
 *
 * These are trademarks of their respective owners, used to state compatibility.
 */
export interface BrandMark {
  title: string;
  path: string;
}

export const brandMarks: Record<string, BrandMark> = {
${rows.join("\n")}
};
`;

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/brand-marks.ts", import.meta.url), out, "utf8");
console.log(`brand-marks.ts written: ${Object.keys(WANTED).length} marks`);
