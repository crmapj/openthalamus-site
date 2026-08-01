import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

// Static by default so every marketing page is prerendered HTML — that is the
// whole SEO argument for this stack. The Node adapter exists only so the single
// waitlist endpoint can opt into server rendering with `prerender = false`;
// nothing else is rendered per-request.
export default defineConfig({
  site: "https://openthalamus.dev",
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [sitemap()],
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
