import { createBlobShareStore } from "./blob";
import { createMemoryShareStore } from "./memory";
import type { ShareStore } from "./store";

/**
 * The share store (ticket #14, ADR 0004): where the published copy of a shared
 * note lives, keyed by its unguessable share id. A small interface with two
 * implementations: Vercel Blob (private blobs, chosen when
 * `BLOB_READ_WRITE_TOKEN` is set) and memory (tests, and development or
 * end-to-end runs without Vercel). Nothing else in the app knows which is in use.
 */
export { createBlobShareStore } from "./blob";
export { createMemoryShareStore } from "./memory";
export type { ShareFile, ShareStore } from "./store";

const MEMORY_STORE = Symbol.for("gh-notepad.share-store");

/**
 * The store the environment calls for. Without a Blob token it is one memory
 * store per process, kept on the global so every route and page of a dev or
 * test server sees the same copies.
 */
export function shareStoreFromEnv(env: Record<string, string | undefined> = process.env): ShareStore {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) return createBlobShareStore({ token });
  const global = globalThis as { [MEMORY_STORE]?: ShareStore };
  global[MEMORY_STORE] ??= createMemoryShareStore();
  return global[MEMORY_STORE];
}
