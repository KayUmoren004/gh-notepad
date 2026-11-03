/** One commit that touched a note's file, wherever the file was at the time. */
export interface Version {
  /** The commit SHA. */
  commit: string;
  /** The note's path at that commit. */
  path: string;
  message: string;
  /** ISO 8601, the commit's author date. */
  date: string;
  /** The author's login, or their name when GitHub can't match the commit to an account. */
  author: string;
}

/** Versions made in one sitting: commits less than `SESSION_GAP_MS` apart, newest first. */
export interface Session {
  versions: Version[];
  /** The newest version's date. */
  latest: string;
  /** The oldest version's date. */
  earliest: string;
}

/** Commits closer than this collapse into one session. */
export const SESSION_GAP_MS = 10 * 60_000;

/**
 * Groups versions into editing sessions: a version joins the session of the
 * version before it when they are less than `gapMs` apart, so a long sitting
 * stays one session however many syncs it took. Sessions and the versions in
 * them come newest first.
 */
export function groupSessions(versions: readonly Version[], gapMs = SESSION_GAP_MS): Session[] {
  const ordered = [...versions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const sessions: Session[] = [];
  let current: Session | null = null;
  for (const version of ordered) {
    if (current && Date.parse(current.earliest) - Date.parse(version.date) < gapMs) {
      current.versions.push(version);
      current.earliest = version.date;
    } else {
      current = { versions: [version], latest: version.date, earliest: version.date };
      sessions.push(current);
    }
  }
  return sessions;
}
