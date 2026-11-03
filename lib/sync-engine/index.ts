/**
 * The sync engine (ADR 0002): brings this device and its notebooks on GitHub
 * into agreement in the background, one sync at a time.
 *
 * - Pull: a conditional head check (an unchanged notebook answers 304), then
 *   the tree and only the blobs this device hasn't seen; remote notes are
 *   matched by frontmatter `id`, falling back to path.
 * - Push: one atomic commit holding every unsynced note, with a readable
 *   message, on top of the head this device last saw; if another device got
 *   there first, pull and retry. More changes than a commit can carry go as
 *   the fewest commits that keep each note's changes together (a rename's new
 *   and old file, a converted v1 note and the v1 file it replaces), numbered
 *   `(1 of 3)`, with progress in the status; a failure part-way leaves what
 *   landed, and the next sync carries on from there.
 * - Typing during a sync is never overwritten: a push only marks a note synced
 *   if its text is still the text that was pushed.
 * - A note changed on both sides is merged three ways, line by line; where
 *   the same lines changed, the device's version stays and the notebook's
 *   becomes a conflict copy beside it, announced as a `Conflict`.
 * - Offline and a signed-out session are states, not errors: sync resumes on
 *   reconnect, or once the member signs in again; other failures are retried
 *   with back-off. Device data is never touched by any of this.
 */
export {
  createSyncEngine,
  type Conflict,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncStatus,
  type Timers,
} from "./engine";
export type { MigrationReport, SkippedFile } from "./migration";
