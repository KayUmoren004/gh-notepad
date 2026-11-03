/**
 * Attachments (ADR 0003): images stored in the notebook under `attachments/`
 * and linked from notes relative to the repository root, so they render on
 * github.com too. Pure functions, used on the device and on the server.
 *
 * - `imageProblem` says why a file can't be attached, in the member's words.
 *   Its size limit is the deployment's (`ATTACHMENT_LIMIT_BYTES`, from
 *   `attachmentLimitBytes(env)`): the same value on the device and in the
 *   attachments route, so an image the deployment can't store never gets in.
 * - `removeImageLinks` takes an attachment's images out of a note's Markdown.
 * - `attachmentPath`, `attachmentLink` and `linkToAttachmentPath` go between
 *   a notebook path (`attachments/<id>.png`) and the link a note holds
 *   (`/attachments/<id>.png`).
 * - `attachmentUrl` is where the app serves one from, with the member's session.
 */
export {
  ATTACHMENT_LIMIT_BYTES,
  ATTACHMENTS_DIR,
  attachmentContentType,
  attachmentLimitBytes,
  attachmentLink,
  attachmentPath,
  attachmentUrl,
  IMAGE_ACCEPT,
  imageProblem,
  isAttachmentPath,
  isImageType,
  linkToAttachmentPath,
  MAX_ATTACHMENT_BYTES,
  removeImageLinks,
  sizeLimitMessage,
} from "./attachments";
