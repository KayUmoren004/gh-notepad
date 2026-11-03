/**
 * The command palette (⌘K / Ctrl+K, or Search in the sidebar): jump to any
 * note on the device by its title or text, or run an action.
 *
 * - `CommandPalette` is a modal dialog with no open or close animation and no
 *   transition on its results: it's used all day, from the keyboard. With an
 *   empty query it lists Recent notes and the actions; with a query, title
 *   matches, then matches in the text with a marked snippet and the note's
 *   path, then the actions the query names. Arrow keys move, Enter runs,
 *   Escape closes. On a phone it fills the screen, input at the top.
 * - The search index (`lib/search`) is built on the device from the store's
 *   notes, so searching works offline.
 * - Actions come from `usePaletteAction`: a component lists an action while it
 *   is mounted, so an action exists exactly when what handles it is on screen.
 *   The note editor registers the editing mode switch this way; Trash, history
 *   and share register "Go to Trash", "Open history" and "Share" as they land.
 */
export { registerPaletteAction, usePaletteAction, type PaletteAction } from "./actions";
export { CommandPalette, type CommandPaletteProps } from "./command-palette";
