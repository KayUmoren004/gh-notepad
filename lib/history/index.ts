/**
 * A note's history, built from the commits that touched its file: pure
 * functions shared by the History panel and its tests.
 *
 * - `groupSessions` folds versions into editing sessions (commits less than
 *   ten minutes apart), newest first.
 * - `diffLines` shows what a newer text added and removed against an older
 *   version, with a little context around each change.
 */
export { CONTEXT_LINES, diffLines, type DiffHunk } from "./diff";
export { groupSessions, SESSION_GAP_MS, type Session, type Version } from "./sessions";
