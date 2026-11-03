/**
 * Source mode's pure parts: editing a note's raw Markdown in CodeMirror
 * without the component.
 *
 * - `minimalChanges` turns a change made elsewhere (a sync) into the smallest
 *   CodeMirror changes, so the cursor and the undo history survive it.
 * - `cursorAnchor` / `findAnchor` carry the cursor between rich text mode and
 *   source mode, by the words around it.
 * - `initialMode` and the mode memory remember the mode chosen for each note
 *   on this device, and open notes rich text mode can't show faithfully in
 *   source mode.
 * - `sourceTheme` styles the editor with the app's design tokens.
 */
export { cursorAnchor, findAnchor, type CursorAnchor, type CursorLocation } from "./cursor-anchor";
export { joinLineEnding, splitLineEnding, type LineEnding } from "./line-endings";
export { minimalChanges, type TextChange } from "./minimal-changes";
export { deviceStorage, initialMode, rememberedMode, rememberMode, type EditingMode, type ModeStorage } from "./mode-memory";
export { sourceTheme } from "./theme";
