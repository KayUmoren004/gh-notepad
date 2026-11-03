"use client";

import dynamic from "next/dynamic";
import type { SourceModeProps } from "./source-mode";

/**
 * Source mode, loaded the first time a note opens in it: CodeMirror and the
 * Markdown grammar are a chunk of their own, outside the app's first load.
 * Never rendered on the server; the editor exists only in a browser.
 */
export const SourceMode = dynamic<SourceModeProps>(() => import("./source-mode").then((module) => module.SourceMode), {
  ssr: false,
  loading: () => <div aria-busy="true" className="min-h-48" />,
});
