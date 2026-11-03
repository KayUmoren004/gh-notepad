import { routes } from "@/lib/remote/contract";

/** The image types a note may attach, with the extension each is stored under. */
const IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
]);

/** Attachments are capped at about 10 MB each (ADR 0003). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The directory that holds a notebook's attachments. */
export const ATTACHMENTS_DIR = "attachments";

/** The `accept` value for a file picker limited to attachable images. */
export const IMAGE_ACCEPT = [...IMAGE_TYPES.keys()].join(",");

/** The content types a route accepts for an attachment's bytes. */
export function isImageType(type: string): boolean {
  return IMAGE_TYPES.has(type);
}

/**
 * Why a file can't be attached, as a message for the member, or `null` when
 * it can: images of the accepted kinds, under the size cap.
 */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Images only (JPEG, PNG, GIF, WebP, SVG)";
  if (file.size === 0) return "The image is empty";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Images must be under 10 MB";
  return null;
}

/** One file name per attachment: an id the app made, and the extension for its type. */
const ATTACHMENT_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9 ._-]*\.([A-Za-z0-9]+)$/;

/** The notebook path of a new attachment of `type`: `attachments/<id>.<ext>`. */
export function attachmentPath(type: string, id: string): string {
  const extension = IMAGE_TYPES.get(type);
  if (!extension) throw new Error(`Not an attachable image type: ${type}`);
  return `${ATTACHMENTS_DIR}/${id}.${extension}`;
}

/**
 * Whether `path` names an attachment: one file directly under `attachments/`
 * with an image extension, nothing hidden and nothing that could escape.
 */
export function isAttachmentPath(path: string): boolean {
  const match = ATTACHMENT_PATH.exec(path);
  return match !== null && CONTENT_TYPES.has(match[1].toLowerCase());
}

/** The content type an attachment is served with, from its extension. */
export function attachmentContentType(path: string): string {
  const match = ATTACHMENT_PATH.exec(path);
  return (match && CONTENT_TYPES.get(match[1].toLowerCase())) ?? "application/octet-stream";
}

/**
 * How a note links to an attachment: relative to the repository root, which
 * github.com resolves against the repository, so the image renders there too.
 */
export function attachmentLink(path: string): string {
  return `/${path}`;
}

/**
 * The attachment a note's image link points at, or `null` for anything else
 * (another site, inline data, a file outside `attachments/`). A link relative
 * to a top-level note (`attachments/x.png`) counts too.
 */
export function linkToAttachmentPath(link: string): string | null {
  const path = link.startsWith("/") ? link.slice(1) : link;
  return isAttachmentPath(path) ? path : null;
}

/**
 * Where the app serves an attachment from: the notebook's attachments route,
 * which needs the member's session. With the blob `sha` the response can be
 * cached for good; without, it is revalidated now and then.
 */
export function attachmentUrl(
  notebook: { owner: string; repo: string; branch: string },
  path: string,
  sha?: string,
): string {
  const query = new URLSearchParams({ branch: notebook.branch });
  if (sha) query.set("sha", sha);
  const name = path.slice(ATTACHMENTS_DIR.length + 1);
  return `${routes.notebook(notebook)}/${ATTACHMENTS_DIR}/${encodeURIComponent(name)}?${query}`;
}
