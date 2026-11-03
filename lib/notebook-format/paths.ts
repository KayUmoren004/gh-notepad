/** The title a note gets when it has none. */
export const UNTITLED = "Untitled";

/** File names stay well under the 255-byte limit of common file systems, leaving room for " 2" and ".md". */
const MAX_TITLE_BYTES = 200;

/** Directories that hold notebook data other than notes. */
const ATTACHMENTS_DIR = "attachments";

const NOTE_EXTENSION = /\.md$/i;

/** Windows refuses these names, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\.|$)/i;

/** The path of the note titled `title` in `folder` (`""` for the top level of the notebook). */
export function notePath(folder: string, title: string): string {
  return folder ? `${folder}/${title}.md` : `${title}.md`;
}

/** The title of the note at `path`: its file name without `.md`. */
export function titleOfPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(NOTE_EXTENSION, "");
}

/** The folder holding `path`, or `""` at the top level. */
export function folderOfPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Whether the file at `path` is a note: a `.md` file outside hidden
 * directories (`.trash/`, `.github/`, …) and `attachments/`.
 */
export function isNotePath(path: string): boolean {
  const segments = path.split("/");
  if (!NOTE_EXTENSION.test(path) || segments[0] === ATTACHMENTS_DIR) return false;
  return segments.every((segment) => segment !== "" && !segment.startsWith("."));
}

/**
 * Whether `path` is safe to write in a notebook: relative, with no empty, `.`
 * or `..` segments, nothing inside `.git`, and no backslashes or control
 * characters. The server checks every path before it reaches GitHub.
 */
export function isSafePath(path: string): boolean {
  if (path === "" || path.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(path)) return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment.toLowerCase() !== ".git");
}

/**
 * Turns whatever a member typed into a title that works as a file name on every
 * system: path separators and reserved characters become `-`, line breaks and
 * tabs become spaces, leading dots and surrounding spaces and trailing dots go,
 * Windows device names get a `_`, and the length is capped without splitting a
 * character. An empty result is "Untitled".
 */
export function sanitizeTitle(raw: string): string {
  let title = raw
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\:*?"<>|]/g, "-");
  title = tidyEnds(capBytes(tidyEnds(title), MAX_TITLE_BYTES));
  if (title === "") return UNTITLED;
  return title.replace(RESERVED_NAME, "$1_");
}

/** Leading dots would hide the file; trailing dots and spaces are dropped by Windows. */
function tidyEnds(title: string): string {
  return title.trim().replace(/^\.+/, "").replace(/[.\s]+$/, "").trim();
}

function capBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let result = "";
  let bytes = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    bytes += encoder.encode(segment).length;
    if (bytes > maxBytes) break;
    result += segment;
  }
  return result;
}

/**
 * The id for a note whose file carries none (written outside the app): derived
 * from where it is, so every device gives it the same id, and the first device
 * to save the note writes that id into its frontmatter.
 */
export function fallbackNoteId(notebook: string, path: string): string {
  const input = `${notebook.toLowerCase()}\u0000${path}`;
  // Four 32-bit FNV-1a hashes with different offsets make 128 bits; not cryptographic, just stable.
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let hash = seed;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  // Shaped as a UUID (version 8: custom), like the ids the app makes for new notes.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * `title`, or `title 2`, `title 3`, … — the first that no title in `taken`
 * uses. Comparison ignores case, since notebooks are checked out on
 * case-insensitive file systems too.
 */
export function uniqueTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (name) => name.toLowerCase()));
  if (!used.has(title.toLowerCase())) return title;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${title} ${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
