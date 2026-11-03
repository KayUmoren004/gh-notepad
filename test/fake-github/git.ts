import { createHash } from "node:crypto";

/**
 * Git's object model, as the fake's repositories store it: blobs, trees and
 * commits addressed by the SHA-1 git itself would give them, so SHAs from the
 * fake can be checked against literals from git and GitHub's documentation.
 */

export type EntryMode = "100644" | "100755" | "040000" | "120000" | "160000";

export interface TreeEntry {
  name: string;
  mode: EntryMode;
  type: "blob" | "tree" | "commit";
  sha: string;
}

export interface Signature {
  name: string;
  email: string;
  /** ISO 8601, whole seconds. */
  date: string;
}

export interface BlobObject {
  type: "blob";
  sha: string;
  content: Buffer;
}

export interface TreeObject {
  type: "tree";
  sha: string;
  entries: TreeEntry[];
}

export interface CommitObject {
  type: "commit";
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author: Signature;
  committer: Signature;
}

export type GitObject = BlobObject | TreeObject | CommitObject;

/** One repository's objects, by SHA. */
export type ObjectStore = Map<string, GitObject>;

/** A file in a flattened tree: its full path, mode and blob SHA. */
export interface FileEntry {
  mode: EntryMode;
  sha: string;
}

function hash(type: GitObject["type"], body: Buffer): string {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
    .digest("hex");
}

export function writeBlob(objects: ObjectStore, content: Buffer): BlobObject {
  const blob: BlobObject = { type: "blob", sha: hash("blob", content), content };
  objects.set(blob.sha, blob);
  return blob;
}

/** Git orders tree entries by name, comparing a subtree's name as if it ended in `/`. */
function treeOrder(a: TreeEntry, b: TreeEntry): number {
  const key = (entry: TreeEntry) => Buffer.from(entry.type === "tree" ? `${entry.name}/` : entry.name);
  return Buffer.compare(key(a), key(b));
}

export function writeTree(objects: ObjectStore, entries: TreeEntry[]): TreeObject {
  const sorted = [...entries].sort(treeOrder);
  const body = Buffer.concat(
    sorted.map((entry) =>
      Buffer.concat([
        Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.name}\0`),
        Buffer.from(entry.sha, "hex"),
      ]),
    ),
  );
  const tree: TreeObject = { type: "tree", sha: hash("tree", body), entries: sorted };
  objects.set(tree.sha, tree);
  return tree;
}

function signatureLine(role: string, signature: Signature): string {
  const seconds = Math.floor(Date.parse(signature.date) / 1000);
  return `${role} ${signature.name} <${signature.email}> ${seconds} +0000\n`;
}

export function writeCommit(objects: ObjectStore, commit: Omit<CommitObject, "type" | "sha">): CommitObject {
  const body = Buffer.from(
    `tree ${commit.tree}\n` +
      commit.parents.map((parent) => `parent ${parent}\n`).join("") +
      signatureLine("author", commit.author) +
      signatureLine("committer", commit.committer) +
      `\n${commit.message}`,
  );
  const written: CommitObject = { type: "commit", sha: hash("commit", body), ...commit };
  objects.set(written.sha, written);
  return written;
}

export function getObject<Type extends GitObject["type"]>(
  objects: ObjectStore,
  sha: string,
  type: Type,
): Extract<GitObject, { type: Type }> | undefined {
  const object = objects.get(sha);
  return object?.type === type ? (object as Extract<GitObject, { type: Type }>) : undefined;
}

/** Every file under a tree, by full path. */
export function flattenTree(objects: ObjectStore, treeSha: string, prefix = ""): Map<string, FileEntry> {
  const files = new Map<string, FileEntry>();
  const tree = getObject(objects, treeSha, "tree");
  for (const entry of tree?.entries ?? []) {
    const path = prefix + entry.name;
    if (entry.type === "tree") {
      for (const [nested, file] of flattenTree(objects, entry.sha, `${path}/`)) files.set(nested, file);
    } else {
      files.set(path, { mode: entry.mode, sha: entry.sha });
    }
  }
  return files;
}

/** Writes the trees for a set of files (directories that end up empty vanish, as in git); returns the root. */
export function buildTree(objects: ObjectStore, files: Map<string, FileEntry>): TreeObject {
  const children = new Map<string, Map<string, FileEntry>>();
  const entries: TreeEntry[] = [];
  for (const [path, file] of files) {
    const slash = path.indexOf("/");
    if (slash === -1) {
      entries.push({ name: path, mode: file.mode, type: file.mode === "160000" ? "commit" : "blob", sha: file.sha });
      continue;
    }
    const name = path.slice(0, slash);
    const nested = children.get(name) ?? new Map<string, FileEntry>();
    nested.set(path.slice(slash + 1), file);
    children.set(name, nested);
  }
  for (const [name, nested] of children) {
    entries.push({ name, mode: "040000", type: "tree", sha: buildTree(objects, nested).sha });
  }
  return writeTree(objects, entries);
}

/** A tree's entries with full paths, depth first in tree order (as `git ls-tree -r -t` lists them). */
export function listTree(
  objects: ObjectStore,
  treeSha: string,
  recursive: boolean,
  prefix = "",
): (TreeEntry & { path: string; size?: number })[] {
  const listing: (TreeEntry & { path: string; size?: number })[] = [];
  for (const entry of getObject(objects, treeSha, "tree")?.entries ?? []) {
    const path = prefix + entry.name;
    const size = entry.type === "blob" ? getObject(objects, entry.sha, "blob")?.content.length : undefined;
    listing.push({ ...entry, path, ...(size === undefined ? {} : { size }) });
    if (recursive && entry.type === "tree") listing.push(...listTree(objects, entry.sha, true, `${path}/`));
  }
  return listing;
}

/** What a commit did to one file, as GitHub describes it (`files[]` of a commit). */
export interface FileChangeSummary {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  /** For `renamed`: where the file was in the parent. */
  previousPath?: string;
  sha: string;
  additions: number;
  deletions: number;
}

/** Git's rename detection threshold: a removed and an added file this alike are one rename. */
const RENAME_SIMILARITY = 0.5;

function textLines(objects: ObjectStore, sha: string): string[] {
  const content = getObject(objects, sha, "blob")?.content.toString("utf8") ?? "";
  return content === "" ? [] : content.replace(/\n$/, "").split("\n");
}

/** Lines added and removed between two blobs, counted the simple way (a multiset difference of lines). */
function lineCounts(objects: ObjectStore, before: string | undefined, after: string | undefined) {
  const old = before ? textLines(objects, before) : [];
  const next = after ? textLines(objects, after) : [];
  const counts = new Map<string, number>();
  for (const line of old) counts.set(line, (counts.get(line) ?? 0) + 1);
  let common = 0;
  for (const line of next) {
    const left = counts.get(line) ?? 0;
    if (left > 0) {
      counts.set(line, left - 1);
      common++;
    }
  }
  return { additions: next.length - common, deletions: old.length - common };
}

/** How alike two blobs are: the share of lines they have in common, 0 to 1. */
function similarity(objects: ObjectStore, before: string, after: string): number {
  const old = textLines(objects, before);
  const next = textLines(objects, after);
  const size = Math.max(old.length, next.length);
  if (size === 0) return 1;
  const { deletions } = lineCounts(objects, before, after);
  return (old.length - deletions) / size;
}

/**
 * The files a commit changed against its first parent, with renames paired
 * up the way git pairs them: a removed and an added file with the same blob,
 * or whose lines are at least half alike.
 */
export function changedFiles(objects: ObjectStore, commit: CommitObject): FileChangeSummary[] {
  const parent = commit.parents[0] ? getObject(objects, commit.parents[0], "commit") : undefined;
  const before = parent ? flattenTree(objects, parent.tree) : new Map<string, FileEntry>();
  const after = flattenTree(objects, commit.tree);
  const removed: string[] = [];
  const added: string[] = [];
  const changes: FileChangeSummary[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(path);
    const next = after.get(path);
    if (!old) added.push(path);
    else if (!next) removed.push(path);
    else if (old.sha !== next.sha) {
      changes.push({ path, status: "modified", sha: next.sha, ...lineCounts(objects, old.sha, next.sha) });
    }
  }

  const renamed = new Set<string>();
  for (const path of added) {
    const sha = (after.get(path) as FileEntry).sha;
    const exact = removed.find((old) => !renamed.has(old) && (before.get(old) as FileEntry).sha === sha);
    const similar =
      exact ??
      removed.find(
        (old) => !renamed.has(old) && similarity(objects, (before.get(old) as FileEntry).sha, sha) >= RENAME_SIMILARITY,
      );
    if (similar === undefined) {
      changes.push({ path, status: "added", sha, ...lineCounts(objects, undefined, sha) });
      continue;
    }
    renamed.add(similar);
    const { additions, deletions } = lineCounts(objects, (before.get(similar) as FileEntry).sha, sha);
    changes.push({ path, status: "renamed", previousPath: similar, sha, additions, deletions });
  }
  for (const path of removed) {
    if (renamed.has(path)) continue;
    const sha = (before.get(path) as FileEntry).sha;
    changes.push({ path, status: "removed", sha, ...lineCounts(objects, sha, undefined) });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Whether `ancestor` is `descendant` or one of its ancestors. */
export function isAncestor(objects: ObjectStore, ancestor: string, descendant: string): boolean {
  const queue = [descendant];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const sha = queue.shift() as string;
    if (sha === ancestor) return true;
    if (seen.has(sha)) continue;
    seen.add(sha);
    queue.push(...(getObject(objects, sha, "commit")?.parents ?? []));
  }
  return false;
}
