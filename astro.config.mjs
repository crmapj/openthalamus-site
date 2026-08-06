import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

// Mirrors `site.lastUpdated` in src/config/site.ts. Duplicated rather than
// imported because astro.config is evaluated before the TS path aliases exist;
// keep the two in sync when you bump it.
const SITE_LAST_UPDATED = "2026-08-06";

// Static by default so every marketing page is prerendered HTML — that is the
// whole SEO argument for this stack. The Node adapter exists only so the single
// waitlist endpoint can opt into server rendering with `prerender = false`;
// nothing else is rendered per-request.
export default defineConfig({
  site: "https://openthalamus.dev",
  output: "static",
  adapter: node({ mode: "standalone" }),
  // `lastmod` is the one sitemap field Google still reads — and only when it is
  // "consistently and verifiably accurate". It therefore comes from the hand-set
  // `site.lastUpdated`, not from build time: a date that moves on every rebuild
  // is a date Google learns to ignore. Bing weights it more heavily still, and
  // Bing's index is what backs ChatGPT and Copilot.
  integrations: [
    sitemap({
      serialize: (item) => ({ ...item, lastmod: `${SITE_LAST_UPDATED}T00:00:00+00:00` }),
    }),
  ],
  build: { inlineStylesheets: "always" },
  compressHTML: true,
  server: { host: true, port: 4321 },

  // Astro's built-in CSRF check compares the Origin header against the host the
  // *server* sees. Behind Cloudflare + Traefik that is http://<internal>, while
  // the browser sends https://openthalamus.dev — so it rejects every legitimate
  // submission. The endpoint does its own proxy-aware origin check against an
  // explicit allowlist instead; see src/pages/api/waitlist.ts.
  security: { checkOrigin: false },
});
