/**
 * Share links in the app (ticket #14): the Share button in a note's actions
 * and the dialog behind it, which shows whether the note is shared, the link
 * with a copy button, and a way to stop sharing. The share id lives in the
 * note's frontmatter (`store.setShare`), so it syncs like any edit and the
 * sync engine keeps the published copy current (`lib/sync-engine/share.ts`).
 */
export { ShareButton } from "./share-button";
export { ShareDialog, type ShareDialogProps } from "./share-dialog";
