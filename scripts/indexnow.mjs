/**
 * Ping IndexNow with the site's URLs.
 *
 * IndexNow is a push protocol: instead of waiting to be crawled, we tell the
 * participating engines a URL changed. Bing, Yandex, Seznam and Naver share one
 * submission — and Bing matters disproportionately here because ChatGPT's search
 * leans on its index.
 *
 * Ownership is proved by hosting the key at `/<key>.txt` containing exactly the
 * key. That file is in `public/`, so it ships with every deploy; do not delete
 * it or submissions start failing with 403.
 *
 * Cloudflare's own Crawler Hints toggle does the same job, but it is not exposed
 * on this zone's API, and a dashboard switch is not something the repo can prove
 * is still on. This is explicit and version-controlled.
 *
 * Run after a deploy that changes content:
 *   node scripts/indexnow.mjs
 */
const KEY = "ba2a0e164f8c7a440aed2995eb9dc7e6";
const HOST = "openthalamus.dev";
const urlList = [
  `https://${HOST}/`,
];

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});

// 200 = accepted, 202 = accepted but key still being validated. Both are fine.
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} url(s)`);
if (![200, 202].includes(res.status)) {
  console.error(await res.text());
  process.exit(1);
}
