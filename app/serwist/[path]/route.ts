import { createSerwistRoute } from "@serwist/turbopack";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * Versions the precached pages below, which have no content hash in their URL.
 * Every deployment gets a new one, so their cached copies never outlive the
 * assets they point at.
 */
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  randomUUID();

/**
 * Bundles `app/sw.ts` with esbuild at build time and serves it as
 * `/serwist/sw.js` (Serwist's Turbopack integration; `@serwist/next` needs webpack).
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  // A classic script, so browsers without module service workers run it too.
  esbuildOptions: { format: "iife" },
  // Next's static output (with fonts) and everything in `public/`.
  globPatterns: [".next/static/**/*.{js,css,woff2,png,svg,ico,webp}", "public/**/*"],
  additionalPrecacheEntries: [
    { url: "/~offline", revision },
    { url: "/manifest.webmanifest", revision },
  ],
});
