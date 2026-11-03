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

/**
 * What a deployment takes in one request. An attachment reaches GitHub in one
 * request to the attachments route, and serverless hosting caps a request
 * body (Vercel at about 4.5 MB), so this stays under that.
 */
const DEFAULT_ATTACHMENT_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * The largest attachment this deployment stores, in bytes: the
 * `NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES` environment variable (a whole number
 * of bytes), otherwise 4 MB, and never over the 10 MB cap. The device's check
 * and the attachments route read the same value, so an image the deployment
 * can't store is refused where it is inserted, before anything is stored.
 */
export function attachmentLimitBytes(env: { NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES?: string }): number {
  const value = env.NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES ?? "";
  if (!/^[1-9][0-9]*$/.test(value)) return DEFAULT_ATTACHMENT_LIMIT_BYTES;
  return Math.min(Number(value), MAX_ATTACHMENT_BYTES);
}

/** This deployment's limit. The literal `process.env` access is what lets Next inline it for the browser. */
export const ATTACHMENT_LIMIT_BYTES = attachmentLimitBytes({
  NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES: process.env.NEXT_PUBLIC_ATTACHMENT_LIMIT_BYTES,
});

/** `bytes` in the member's units: "1 KB", "4 MB", "4.5 MB". */
function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  const [value, unit] = megabytes >= 1 ? [megabytes, "megabyte"] : [bytes / 1024, "kilobyte"];
  return new Intl.NumberFormat(undefined, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}

/** The refusal of an image over `limit`, as the member reads it: "Images must be under 4 MB". */
export function sizeLimitMessage(limit: number): string {
  return `Images must be under ${formatBytes(limit)}`;
}

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
 * it can: images of the accepted kinds, no larger than `limit` (this
 * deployment's, unless told otherwise).
 */
export function imageProblem(file: { type: string; size: number }, limit = ATTACHMENT_LIMIT_BYTES): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Images only (JPEG, PNG, GIF, WebP, SVG)";
  if (file.size === 0) return "The image is empty";
  if (file.size > limit) return sizeLimitMessage(limit);
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The note's Markdown without the images that embed the attachment at `path`,
 * however the note links it (`/attachments/x.png` or `attachments/x.png`,
 * with or without a title). A line the removal leaves empty goes too, so no
 * blank paragraph remains where the image stood alone.
 */
export function removeImageLinks(markdown: string, path: string): string {
  const image = new RegExp(`!\\[[^\\]]*\\]\\(\\s*/?${escapeRegExp(path)}(?:\\s+(?:"[^"]*"|'[^']*'))?\\s*\\)`, "g");
  if (!image.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    image.lastIndex = 0;
    if (!image.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    const rest = lines[i].replace(image, "");
    if (rest.trim() !== "") {
      kept.push(rest);
      continue;
    }
    // The image's own paragraph goes: its line, and the blank line that separated it from the next.
    if (kept.at(-1)?.trim() === "" && lines[i + 1]?.trim() === "") i++;
  }
  return kept.join("\n");
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
