/**
 * Share links (ticket #14, ADR 0004): a read-only public copy of one note,
 * published under an unguessable id to the share store and served at
 * `/s/<id>` without a session.
 *
 * - `newShareId` makes the id (128 random bits); `isShareId` checks the shape.
 * - `renderShareHtml` turns the note's Markdown into HTML with nothing unsafe
 *   in it: raw HTML shown as text, links limited to the web and mail, images
 *   limited to the notebook's attachments (pointed at the published copies)
 *   and the web.
 * - `publishShare` reads the note at its notebook's head on GitHub, renders
 *   it, copies the attachments it uses and puts the lot in the store under the
 *   id in the note's frontmatter; `revokeShare` deletes a copy. Neither ever
 *   includes another note, the frontmatter, or a private attachment URL.
 * - `sharePath` and `shareUrl` name the public page.
 */
export { publishShare, revokeShare, SHARE_NOTE_FILE, type PublishedNote, type PublishOutcome, type RevokeOutcome } from "./publish";
export { renderShareHtml, type RenderedShare, type RenderOptions } from "./render";
export { isShareId, newShareId } from "./share-id";
export { sharePath, shareUrl } from "./urls";
