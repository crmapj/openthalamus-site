/**
 * Generates the raster icon set from the thalamus mark.
 *
 *   public/favicon-32.png      classic favicon
 *   public/favicon-192.png     Android / PWA
 *   public/apple-touch-icon.png  180x180, iOS home screen
 *   public/logo-512.png        Organization.logo in JSON-LD
 *
 * Two things this fixes:
 *
 * 1. The site shipped an SVG favicon only. Support is now good but not
 *    universal, and the fallback when it fails is a blank icon.
 * 2. Google requires `Organization.logo` to be at least 112x112 and to read
 *    correctly **on a white background**. The bare mark is #f2f2f2 — on white it
 *    is invisible. Every icon here is therefore drawn as the light mark on the
 *    product's own near-black tile, which reads on any backdrop.
 *
 * librsvg (via sharp) renders these fine because the mark is pure path data
 * with no text.
 *
 *   node scripts/build-icons.mjs
 */
import sharp from "sharp";

const OUT = new URL("../public/", import.meta.url).pathname;

/** Radius follows the iOS squircle proportion (~22.4% of the side). */
const tile = (size) => {
  const r = Math.round(size * 0.224);
  const s = size / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#0a0a0a"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${s * 0.86}) translate(-48 -48)">
    <path d="M30 27 C40 27 45.5 40.7 45.5 51.2 C45.5 63.8 38.5 69 30 69 C21.5 69 14.5 63.8 14.5 51.2 C14.5 40.7 20 27 30 27 Z" fill="#f2f2f2" transform="rotate(-18 30 48)"/>
    <path d="M66 27 C76 27 81.5 40.7 81.5 51.2 C81.5 63.8 74.5 69 66 69 C57.5 69 50.5 63.8 50.5 51.2 C50.5 40.7 56 27 66 27 Z" fill="#f2f2f2" transform="rotate(18 66 48)"/>
  </g>
</svg>`;
};

const targets = [
  { file: "favicon-32.png", size: 32 },
  { file: "favicon-192.png", size: 192 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "logo-512.png", size: 512 },
];

for (const { file, size } of targets) {
  await sharp(Buffer.from(tile(size)), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(OUT + file);
  console.log(`${file} (${size}x${size})`);
}
