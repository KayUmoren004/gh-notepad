/**
 * Draws the app's mark (a sheet of notepaper with a folded corner on a warm-gray
 * tile) and writes every icon the app ships: the favicon, the SVG icon, the Apple
 * touch icon and the manifest's "any" and "maskable" PNGs.
 *
 *   node scripts/generate-icons.mjs
 *
 * Uses `sharp`, which Next.js installs for image optimisation. Colours are the
 * theme's tokens from app/globals.css.
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const color = {
  tileTop: "#2a2826", // --muted
  tileBottom: "#191817", // --background
  paper: "#e7e4df", // --foreground
  fold: "#b3ada4",
  title: "#2a2826",
  line: "#9d9890", // --muted-foreground
};

/**
 * The mark on a 512 × 512 canvas. `shape` is "tile" (rounded corners, for icons
 * shown as they are) or "bleed" (a full square, for icons the platform masks).
 * `detail: "small"` enlarges the sheet and keeps only two bold lines, for favicon sizes.
 */
function markSvg({ shape, detail = "full" }) {
  const background =
    shape === "tile" ? `<rect width="512" height="512" rx="112" fill="url(#tile)"/>` : `<rect width="512" height="512" fill="url(#tile)"/>`;
  // The sheet: 208 × 264, centred, with its top-right corner folded down. Drawn 8 units
  // inside its outline and stroked 16 wide with round joins, so every corner is softened.
  const sheet = "M180 132 H284 L352 200 V360 A20 20 0 0 1 332 380 H180 A20 20 0 0 1 160 360 V152 A20 20 0 0 1 180 132 Z";
  const fold = "M284 132 V188 A12 12 0 0 0 296 200 H352 Z";
  const lines =
    detail === "full"
      ? `<path d="M200 236 H280" stroke="${color.title}" stroke-width="22" stroke-linecap="round"/>
         <path d="M200 284 H312 M200 320 H312 M200 356 H264" stroke="${color.line}" stroke-width="14" stroke-linecap="round"/>`
      : `<path d="M200 244 H288" stroke="${color.title}" stroke-width="32" stroke-linecap="round"/>
         <path d="M200 316 H304" stroke="${color.line}" stroke-width="28" stroke-linecap="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color.tileTop}"/>
      <stop offset="1" stop-color="${color.tileBottom}"/>
    </linearGradient>
  </defs>
  ${background}
  <g${detail === "full" ? "" : ` transform="translate(256 256) scale(1.2) translate(-256 -256)"`}>
    <path d="${sheet}" fill="${color.paper}" stroke="${color.paper}" stroke-width="16" stroke-linejoin="round"/>
    <path d="${fold}" fill="${color.fold}" stroke="${color.fold}" stroke-width="8" stroke-linejoin="round"/>
    ${lines}
  </g>
</svg>
`;
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An .ico holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const tile = markSvg({ shape: "tile" });
const bleed = markSvg({ shape: "bleed" });
const smallTile = markSvg({ shape: "tile", detail: "small" });

await mkdir("public/icons", { recursive: true });
await writeFile("public/icon.svg", tile);
await writeFile(
  "public/favicon.ico",
  ico([
    { size: 16, data: await png(smallTile, 16) },
    { size: 32, data: await png(smallTile, 32) },
    { size: 48, data: await png(tile, 48) },
  ]),
);
// iOS rounds the corners itself and fills transparency with black, so it gets the full square.
await writeFile("public/apple-touch-icon.png", await png(bleed, 180));
for (const size of [192, 512]) {
  await writeFile(`public/icons/icon-${size}.png`, await png(tile, size));
  // The sheet stays inside the maskable safe zone (a circle 80% of the icon wide).
  await writeFile(`public/icons/maskable-${size}.png`, await png(bleed, size));
}
