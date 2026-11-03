import type { MetadataRoute } from "next";

/** Matches `--background` in app/globals.css and `themeColor` in app/layout.tsx. */
const background = "#191817";

/** What the browser needs to install the app; the icons come from scripts/generate-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Notepad",
    short_name: "Notepad",
    description: "Notes kept as Markdown files in your own GitHub repositories, on every device, online or not.",
    lang: "en",
    dir: "ltr",
    start_url: "/notes",
    scope: "/",
    display: "standalone",
    background_color: background,
    theme_color: background,
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
