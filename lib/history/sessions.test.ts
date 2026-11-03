import { describe, expect, it } from "vitest";
import { groupSessions, SESSION_GAP_MS, type Version } from ".";

const MINUTE = 60_000;
const start = Date.parse("2026-11-03T10:00:00Z");

function version(minutesAgo: number, message = `Edit at -${minutesAgo}`): Version {
  return {
    commit: `${minutesAgo}`.padStart(40, "0"),
    path: "Ideas.md",
    message,
    date: new Date(start - minutesAgo * MINUTE).toISOString(),
    author: "octo-member",
  };
}

describe("groupSessions", () => {
  it("has no sessions for a note with no versions", () => {
    expect(groupSessions([])).toEqual([]);
  });

  it("puts one version in a session of its own", () => {
    const only = version(0);
    expect(groupSessions([only])).toEqual([{ versions: [only], latest: only.date, earliest: only.date }]);
  });

  it("collapses commits made less than ten minutes apart into one session, newest first", () => {
    const versions = [version(0), version(4), version(9), version(30), version(38)];

    const sessions = groupSessions(versions);

    expect(sessions.map((session) => session.versions.map((v) => v.commit))).toEqual([
      [versions[0].commit, versions[1].commit, versions[2].commit],
      [versions[3].commit, versions[4].commit],
    ]);
    expect(sessions[0]).toMatchObject({ latest: versions[0].date, earliest: versions[2].date });
    expect(sessions[1]).toMatchObject({ latest: versions[3].date, earliest: versions[4].date });
  });

  it("measures the gap from the previous commit, so a long session stays one session", () => {
    const versions = [version(0), version(9), version(18), version(27)];
    expect(groupSessions(versions)).toHaveLength(1);
  });

  it("starts a new session at a gap of exactly the threshold", () => {
    const versions = [version(0), version(10)];
    expect(groupSessions(versions)).toHaveLength(2);
    expect(groupSessions([version(0), version(9.99)])).toHaveLength(1);
    expect(SESSION_GAP_MS).toBe(10 * MINUTE);
  });

  it("takes its threshold from the caller", () => {
    const versions = [version(0), version(2), version(5)];
    expect(groupSessions(versions, MINUTE)).toHaveLength(3);
    expect(groupSessions(versions, 3 * MINUTE)).toHaveLength(2);
  });

  it("sorts versions newest first whatever order they arrive in", () => {
    const versions = [version(30), version(0), version(4)];
    const sessions = groupSessions(versions);
    expect(sessions.map((session) => session.versions.map((v) => v.commit))).toEqual([
      [versions[1].commit, versions[2].commit],
      [versions[0].commit],
    ]);
  });
});
