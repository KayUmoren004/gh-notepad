/**
 * Draws the app's mark, the landing page's wordmark (lucide's NotebookPen on a
 * rounded warm-gray tile, app/page.tsx), and writes every icon the app ships:
 * the favicon, the SVG icon, the Apple touch icon and the manifest's "any" and
 * "maskable" PNGs.
 *
 *   node scripts/generate-icons.mjs
 *
 * Uses `sharp`, which Next.js installs for image optimisation. Colours are the
 * theme's tokens from app/globals.css; keep them in step with the wordmark.
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const color = {
  tile: "#e7e4df", // --primary, the wordmark's tile
  glyph: "#191817", // --primary-foreground
};

/** lucide-react's NotebookPen, on its 24-unit grid. */
const notebookPen = [
  "M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4",
  "M2 6h4M2 10h4M2 14h4M2 18h4",
  "M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",
];

/**
 * The mark on a 512 × 512 canvas. `shape` is "tile" (the wordmark's rounded
 * corners, for icons shown as they are) or "bleed" (a full square, for icons the
 * platform masks). `glyph` is the icon's share of the canvas width; the wordmark's
 * is 16 of 28 px.
 */
function markSvg({ shape, glyph = 16 / 28, strokeWidth = 2 }) {
  const scale = (512 * glyph) / 24;
  const offset = (512 - 24 * scale) / 2;
  // The wordmark's `rounded-lg` (8 px) on its 28 px tile.
  const radius = shape === "tile" ? (512 * 8) / 28 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius.toFixed(1)}" fill="${color.tile}"/>
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale.toFixed(4)})" fill="none" stroke="${color.glyph}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    ${notebookPen.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
</svg>
`;
}

const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

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
// Favicons are tiny: a larger, slightly bolder glyph keeps the lines from blurring away.
const smallTile = markSvg({ shape: "tile", glyph: 0.7, strokeWidth: 2.25 });
// Masked platforms may crop to a circle 80% of the icon wide; the glyph stays well inside it.
const maskable = markSvg({ shape: "bleed", glyph: 0.48 });
// iOS rounds the corners itself and fills transparency with black, so it gets the full square.
const apple = markSvg({ shape: "bleed" });

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
await writeFile("public/apple-touch-icon.png", await png(apple, 180));
for (const size of [192, 512]) {
  await writeFile(`public/icons/icon-${size}.png`, await png(tile, size));
  await writeFile(`public/icons/maskable-${size}.png`, await png(maskable, size));
}
