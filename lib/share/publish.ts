import { attachmentContentType } from "@/lib/attachments";
import type { MemberGitHub, NotebookLocation } from "@/lib/github-gateway";
import { readNote, titleOfPath } from "@/lib/notebook-format";
import type { ShareFile, ShareStore } from "@/lib/share-store";
import { renderShareHtml } from "./render";
import { isShareId } from "./share-id";
import { sharePath } from "./urls";

/** The file of a published copy that holds the rendered note. */
export const SHARE_NOTE_FILE = "note.json";

/** What `note.json` holds: what the public page shows, and who may replace it. */
export interface PublishedNote {
  title: string;
  html: string;
  /** The note's `updated` timestamp for the page's "Updated" line, when the note has one. */
  updated: string | null;
  /** `owner/repo`, lowercased: only this notebook may republish or revoke the copy. Never shown. */
  notebook: string;
}

export type PublishOutcome =
  | { status: "published"; id: string }
  /** The notebook's head has no note at that path: it hasn't synced yet, or moved. */
  | { status: "no-such-note" }
  /** The note at head carries no share id, so there is nothing to publish under. */
  | { status: "not-shared" }
  /** Another notebook's copy already lives under that id. */
  | { status: "taken" };

export type RevokeOutcome = { status: "revoked" } | { status: "taken" };

const notebookKey = ({ owner, repo }: NotebookLocation) => `${owner}/${repo}`.toLowerCase();

async function publishedNote(store: ShareStore, id: string): Promise<PublishedNote | null> {
  const file = await store.get(id, SHARE_NOTE_FILE);
  if (!file) return null;
  try {
    return JSON.parse(new TextDecoder().decode(file.bytes)) as PublishedNote;
  } catch {
    return null;
  }
}

/**
 * Publishes the note at `path` as it stands at the notebook's head on GitHub,
 * under the share id its frontmatter carries: the title and rendered body in
 * `note.json`, and a copy of each attachment the body shows. A copy already
 * under that id is replaced, unless it belongs to another notebook.
 */
export async function publishShare({
  gitHub,
  notebook,
  path,
  store,
}: {
  gitHub: MemberGitHub;
  notebook: NotebookLocation;
  path: string;
  store: ShareStore;
}): Promise<PublishOutcome> {
  const { commit } = await gitHub.getHead(notebook, null);
  const files = await gitHub.listFiles(notebook, commit);
  const note = files.find((file) => file.path === path);
  if (!note) return { status: "no-such-note" };
  const text = (await gitHub.readTextBlobs(notebook, [note.sha]))[note.sha] ?? "";
  const fields = readNote(text);
  if (!fields.share || !isShareId(fields.share)) return { status: "not-shared" };
  const id = fields.share;

  const existing = await publishedNote(store, id);
  if (existing && existing.notebook !== notebookKey(notebook)) return { status: "taken" };

  const inNotebook = new Map(files.map((file) => [file.path, file.sha]));
  const { html, attachments } = renderShareHtml(fields.body, {
    // Served by the share page's own attachments route, never through the notebook routes.
    attachmentSrc: (attachment) => (inNotebook.has(attachment) ? `${sharePath(id)}/${attachment}` : null),
  });
  const published: PublishedNote = {
    title: titleOfPath(path),
    html,
    updated: fields.updated,
    notebook: notebookKey(notebook),
  };
  const copies: ShareFile[] = [
    { path: SHARE_NOTE_FILE, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(published)) },
  ];
  for (const attachment of attachments) {
    const blob = await gitHub.readBlob(notebook, attachment, inNotebook.get(attachment) ?? null);
    if (blob) copies.push({ path: attachment, contentType: attachmentContentType(attachment), bytes: new Uint8Array(blob.bytes) });
  }
  await store.put(id, copies);
  return { status: "published", id };
}

/** Deletes the copy under `id`, if it is this notebook's. A copy already gone counts as revoked. */
export async function revokeShare({
  notebook,
  id,
  store,
}: {
  notebook: NotebookLocation;
  id: string;
  store: ShareStore;
}): Promise<RevokeOutcome> {
  const existing = await publishedNote(store, id);
  if (existing && existing.notebook !== notebookKey(notebook)) return { status: "taken" };
  await store.delete(id);
  return { status: "revoked" };
}
