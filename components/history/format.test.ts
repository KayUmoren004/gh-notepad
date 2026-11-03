import { describe, expect, it } from "vitest";
import { changesLabel, dayLabel, hiddenLinesLabel, sessionLabel } from "./format";

const now = new Date(2026, 10, 3, 15, 0); // 3 Nov 2026, local time

describe("history labels", () => {
  it("name the day relative to now, then by date", () => {
    expect(dayLabel(new Date(2026, 10, 3, 9, 0).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 2, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 30, 12, 0).toISOString(), now)).toMatch(/Fri.*30.*Oct|Oct.*30/);
    expect(dayLabel(new Date(2025, 9, 30, 12, 0).toISOString(), now)).toMatch(/2025/);
  });

  it("count changes and hidden lines, one included", () => {
    expect(changesLabel(1)).toBe("1 change");
    expect(changesLabel(3)).toBe("3 changes");
    expect(changesLabel(1024)).toBe("1,024 changes");
    expect(hiddenLinesLabel(1)).toBe("1 unchanged line");
    expect(hiddenLinesLabel(13)).toBe("13 unchanged lines");
  });

  it("label a session by its latest version and its size", () => {
    const latest = new Date(2026, 10, 3, 14, 2).toISOString();
    const version = { commit: "a", path: "Ideas.md", message: "Edit", date: latest, author: "octo" };
    expect(sessionLabel({ versions: [version, version, version], latest, earliest: latest }, now)).toMatch(
      /^Today \d{1,2}:02(?: [AP]M)? · 3 changes$/,
    );
  });
});
