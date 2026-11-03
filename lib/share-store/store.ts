/** One file of a published copy: the rendered note, or an attachment it uses. */
export interface ShareFile {
  /** Relative to the copy: `note.json`, `attachments/<id>.png`. */
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Where published copies of shared notes live, by share id. The id is the only
 * key: whoever holds it can read the copy, which is what a share link is.
 */
export interface ShareStore {
  /** Replaces the copy under `id` with exactly these files; files no longer listed are removed. */
  put: (id: string, files: readonly ShareFile[]) => Promise<void>;
  /** One file of the copy, or `null` when there is no such copy or file. */
  get: (id: string, path: string) => Promise<ShareFile | null>;
  /** Removes the copy. Nothing to remove is fine. */
  delete: (id: string) => Promise<void>;
}
