/**
 * The sync engine (ADR 0002): brings this device and its notebooks on GitHub
 * into agreement in the background, one sync at a time.
 *
 * - Pull: a conditional head check (an unchanged notebook answers 304), then
 *   the tree and only the blobs this device hasn't seen; remote notes are
 *   matched by frontmatter `id`, falling back to path.
 * - Push: one atomic commit holding every unsynced note, with a readable
 *   message, on top of the head this device last saw; if another device got
 *   there first, pull and retry.
 * - Typing during a sync is never overwritten: a push only marks a note synced
 *   if its text is still the text that was pushed.
 */
export {
  createSyncEngine,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncStatus,
  type Timers,
} from "./engine";
