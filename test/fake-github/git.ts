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
