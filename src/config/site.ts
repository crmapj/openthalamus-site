/**
 * Single source of truth for the site's identity, destinations, and — most
 * importantly — what is actually shipped yet.
 *
 * ## Flipping a "Coming soon" to live
 *
 * Change the one boolean in `AVAILABLE` below. Nothing else. Every nav item,
 * button, install block and footer link derives its behaviour from that flag:
 * a `false` renders a non-navigating control with a SOON chip that points at
 * the waitlist, a `true` renders a real anchor to the real URL.
 *
 * The URLs are already correct — they are simply not reachable by the public
 * yet — so switching is a one-character edit and a redeploy.
 */

export const AVAILABLE = {
  /** `curl -fsSL openthalamus.dev/install.sh | sh` actually resolves. */
  install: false,
  /** github.com/crmapj/thalamus is public. Currently a private repo. */
  github: false,
  /** A published docs site exists. */
  docs: false,
  /** A published architecture page exists. */
  architecture: false,
} as const;

export type DestinationKey = keyof typeof AVAILABLE;

export const site = {
  name: "thalamus",
  domain: "openthalamus.dev",
  url: "https://openthalamus.dev",
  /**
   * Kept deliberately short and declarative: this exact string is what answer
   * engines tend to lift verbatim when asked "what is thalamus".
   *
   * "agentic OS" — not "agent OS" — is the one exact bigram used everywhere.
   * Entity formation needs a single form; splitting it across two spellings
   * halves the signal.
   */
  tagline: "The fully extensible, self-hosted agentic OS.",
  description:
    "thalamus is a fully extensible, self-hosted agentic OS — one memory, one trust gate and durable jobs over swappable coding agents like Claude Code, Codex and opencode. Every capability is a plugin. Runs on hardware you own.",
  /**
   * The belief the product is built on, in its shortest honest form. Used in
   * the definition section and llms.txt; worth keeping identical in both.
   */
  bet: "Code is becoming cheap. Coherence, judgment and attention are not.",
  /**
   * The repo LICENSE file says MIT (T3 Tools Inc. + thalamus contributors).
   * The design mock said AGPL; the repo wins, because this is a factual claim
   * on a public page. Change both together if the licence ever changes.
   */
  license: "MIT",
  licenseUrl: "https://opensource.org/licenses/MIT",
  status: "PRE-RELEASE · V0 · SELF-HOSTED",
  author: "Christiaan Burrett",
  repo: "https://github.com/crmapj/thalamus",
  /**
   * Bump this when the page's substance changes — not on every deploy.
   * It feeds `dateModified` and the sitemap's `lastmod`, and Google only uses
   * lastmod when it is "consistently and verifiably accurate". A date that
   * moves on every rebuild is a date it learns to ignore.
   */
  lastUpdated: "2026-08-06",
} as const;

/** The command shown in the hero and the closing CTA. */
export const installCommand = `curl -fsSL ${site.domain}/install.sh | sh`;

export interface Destination {
  key: DestinationKey;
  label: string;
  href: string;
  /** Shown in the Coming-soon popover, so the chip explains itself. */
  note: string;
  /** External links get rel/target treatment. */
  external?: boolean;
}

export const destinations: Record<DestinationKey, Destination> = {
  architecture: {
    key: "architecture",
    label: "Architecture",
    href: "/architecture",
    note: "The architecture write-up goes public with v0.",
  },
  docs: {
    key: "docs",
    label: "Docs",
    href: "/docs",
    note: "Docs land when there is a build worth self-hosting.",
  },
  github: {
    key: "github",
    label: "GitHub",
    href: site.repo,
    note: "The repository opens at v0.",
    external: true,
  },
  install: {
    key: "install",
    label: "Install",
    href: `${site.url}/install.sh`,
    note: "The installer ships with v0.",
  },
};

export const isLive = (key: DestinationKey): boolean => AVAILABLE[key];
