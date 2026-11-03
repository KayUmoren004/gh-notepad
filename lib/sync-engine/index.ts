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
 * - Attachments inserted on the device are stored on GitHub as blobs first,
 *   then named in the same commit as the notes that embed them
 *   (`attachments.ts`). One the deployment refuses for good (over its size
 *   limit) is marked failed in the store and left out, so the notes still
 *   sync; the idle status counts them (`failedAttachments`).
 * - Every notebook the member can open is synced, the personal one first:
 *   the list is asked for on start, every few minutes, and on demand
 *   (`refreshNotebooks`, after creating a notebook or accepting an
 *   invitation). A notebook that appears is located and synced from then on;
 *   one the member left or was removed from is forgotten from the device,
 *   notes and all. One notebook failing doesn't hold up the rest.
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
