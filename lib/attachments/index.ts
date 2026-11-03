/**
 * Attachments (ADR 0003): images stored in the notebook under `attachments/`
 * and linked from notes relative to the repository root, so they render on
 * github.com too. Pure functions, used on the device and on the server.
 *
 * - `imageProblem` says why a file can't be attached, in the member's words.
 * - `attachmentPath`, `attachmentLink` and `linkToAttachmentPath` go between
 *   a notebook path (`attachments/<id>.png`) and the link a note holds
 *   (`/attachments/<id>.png`).
 * - `attachmentUrl` is where the app serves one from, with the member's session.
 */
export {
  ATTACHMENTS_DIR,
  attachmentContentType,
  attachmentLink,
  attachmentPath,
  attachmentUrl,
  IMAGE_ACCEPT,
  imageProblem,
  isAttachmentPath,
  isImageType,
  linkToAttachmentPath,
  MAX_ATTACHMENT_BYTES,
} from "./attachments";
