/**
 * Source mode: a note body edited as its exact Markdown, and the control that
 * switches a note between rich text mode and source mode. `SourceMode` here
 * is loaded on demand, so importing this module costs nothing until a note
 * opens in source mode; its handle carries the cursor across a switch.
 */
export { SourceMode } from "./lazy";
export { ModeToggle, type ModeToggleProps } from "./mode-toggle";
export type { SourceModeHandle, SourceModeProps } from "./source-mode";
