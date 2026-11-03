import { readNote, writeNote } from "./note-file";
import { fallbackNoteId, folderOfPath, notePath, sanitizeTitle, titleOfPath, uniqueTitle } from "./paths";

/** A file's path and text content. */
export interface TextFile {
  path: string;
  text: string;
}

/** What converting a notebook's v1 data into the notebook format comes to. */
export interface V1Migration {
  /** One note file for each v1 note the notebook doesn't have yet, with the note's id. */
  notes: { id: string; path: string; text: string }[];
  /** A `<folder>/.gitkeep` for each folder v1 listed that holds no notes, so it stays as an empty folder. */
  folders: string[];
  /** Every v1 file: the migration removes them all (git history keeps them). */
  removed: string[];
  /** v1 files that couldn't be read, and why; nothing of them is converted. */
  skipped: { path: string; reason: string }[];
}

const V1_NOTES_DIR = "notes/";
const V1_NOTE = /^notes\/[^/]+\.json$/;
const V1_METADATA = "metadata.json";
/** What an empty folder holds, since git has no empty directories. */
const KEEP_FILE = ".gitkeep";

/** Whether `path` is one of v1's files: a note at `notes/<id>.json`, or the root `metadata.json`. */
export function isV1Path(path: string): boolean {
  return path === V1_METADATA || V1_NOTE.test(path);
}

/** A readable v1 note, as v1 stored it. */
interface V1Note {
  path: string;
  /** The `<id>` of `notes/<id>.json`: v1 named each file after its note's id. */
  fileId: string;
  fields: Record<string, unknown>;
  created: string | null;
}

/**
 * Converts v1 data (`notes/<id>.json` notes and `metadata.json`) into the
 * notebook format. Pure, so every device converts the same data the same way,
 * and running it again over its own output converts nothing twice.
 *
 * - Each note becomes `<folder>/<title>.md` with its v1 `id`, tags and
 *   timestamps in frontmatter; titles are sanitised and de-duplicated in their
 *   folder, the oldest note keeping a shared title.
 * - Missing or mistyped fields fall back to the file name's id, "Untitled",
 *   the top level, no tags and no timestamps; files that aren't JSON objects
 *   are skipped and reported. Tag colours have no place in the format.
 * - `existing` are the notes the notebook (or this device) already has: their
 *   paths are never taken, and a v1 note whose id one of them carries has
 *   already been converted.
 */
export function migrateV1(files: readonly TextFile[], existing: readonly TextFile[] = []): V1Migration {
  const v1 = files.filter((file) => isV1Path(file.path)).sort((a, b) => compare(a.path, b.path));
  const readable: V1Note[] = [];
  const listedFolders: string[] = [];
  const skipped: V1Migration["skipped"] = [];

  for (const file of v1) {
    const metadata = file.path === V1_METADATA;
    const fields = readObject(file.text);
    if (fields === "invalid") {
      skipped.push({ path: file.path, reason: "isn't valid JSON" });
    } else if (fields === "not an object") {
      skipped.push({ path: file.path, reason: metadata ? "isn't v1 metadata" : "isn't a v1 note" });
    } else if (metadata) {
      if (Array.isArray(fields.folders)) listedFolders.push(...fields.folders.map(folderOf));
    } else {
      const fileId = file.path.slice(V1_NOTES_DIR.length, -".json".length);
      readable.push({ path: file.path, fileId, fields, created: text(fields.createdAt) });
    }
  }

  // The oldest note keeps a shared title and id; a file named after its id is the original of any copies.
  readable.sort(
    (a, b) =>
      compare(a.created ?? "￿", b.created ?? "￿") ||
      Number(text(b.fields.id) === b.fileId) - Number(text(a.fields.id) === a.fileId) ||
      compare(a.path, b.path),
  );

  const converted = new Set(existing.map((file) => readNote(file.text).id));
  const claimed = new Set<string>();
  const titles = new Map<string, string[]>();
  for (const { path } of existing) taken(titles, folderOfPath(path)).push(titleOfPath(path));

  const notes: V1Migration["notes"] = [];
  for (const note of readable) {
    const { fields } = note;
    const id = [text(fields.id), note.fileId].find((candidate) => candidate && !claimed.has(candidate)) ?? fallbackNoteId("", note.path);
    claimed.add(id);
    if (converted.has(id)) continue;

    const folder = folderOf(fields.folder);
    const inFolder = taken(titles, folder);
    const title = uniqueTitle(sanitizeTitle(text(fields.title) ?? ""), inFolder);
    inFolder.push(title);
    const tags = Array.isArray(fields.tags) ? fields.tags.map(text).filter((tag): tag is string => tag !== null) : [];
    notes.push({
      id,
      path: notePath(folder, title),
      text: writeNote("", {
        id,
        tags: [...new Set(tags)],
        created: note.created,
        updated: text(fields.updatedAt),
        body: typeof fields.content === "string" ? fields.content : "",
      }),
    });
  }

  const filled = new Set([...existing, ...notes].flatMap((file) => ancestors(file.path)));
  const folders = [...new Set(listedFolders)]
    .filter((folder) => folder !== "" && !filled.has(folder))
    .sort(compare)
    .map((folder) => `${folder}/${KEEP_FILE}`);

  return { notes, folders, removed: v1.map((file) => file.path), skipped };
}

/** v1 wrote every file as one JSON object. */
function readObject(json: string): Record<string, unknown> | "invalid" | "not an object" {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return "invalid";
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : "not an object";
}

/** The titles each folder already uses. */
function taken(titles: Map<string, string[]>, folder: string): string[] {
  let list = titles.get(folder);
  if (!list) titles.set(folder, (list = []));
  return list;
}

/** Every folder holding `path`, from the outermost in: `a/b/c.md` is in `a` and `a/b`. */
function ancestors(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/** v1 folders are one level of free-text names; each becomes a top-level folder, `""` for none. */
function folderOf(name: unknown): string {
  const folder = text(name);
  return folder === null ? "" : sanitizeTitle(folder);
}

/** A field's text, trimmed; `null` when it is missing, empty or not a string. */
function text(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
