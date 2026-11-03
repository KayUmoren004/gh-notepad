import { describe, expect, it } from "vitest";
import { canonicalTags, cleanTags, filterByTags, indexTags, normalizeTag, tagKey } from ".";

let counter = 0;
/** A note as the device store shows it, with the fields tags read. */
function note(tags: string[], created: string | null = `2026-01-0${++counter}T00:00:00.000Z`) {
  return { id: `id-${counter}`, tags, created };
}

describe("tags: one tag", () => {
  it.each([
    ["  work ", "work"],
    ["reading   list", "reading list"],
    ["line\nbreak\tand tab", "line break and tab"],
    ["", ""],
    ["   ", ""],
    ["日本語", "日本語"],
    ["🍕 pizza", "🍕 pizza"],
  ])("normalises %j to %j", (raw, tag) => {
    expect(normalizeTag(raw)).toBe(tag);
  });

  it("matches case-insensitively, across scripts and composed characters", () => {
    expect(tagKey("Work")).toBe(tagKey("WORK"));
    expect(tagKey("Été")).toBe(tagKey("été"));
    expect(tagKey("Café")).toBe(tagKey("café"));
    expect(tagKey("work")).not.toBe(tagKey("works"));
  });

  it("cleans a list as typed: empties dropped, duplicates dropped keeping the first casing", () => {
    expect(cleanTags([" Work", "", "home ", "work", "HOME", "  "])).toEqual(["Work", "home"]);
    expect(cleanTags([])).toEqual([]);
  });
});

describe("tags: the index across notes", () => {
  it("counts the notes each tag is on, sorted by count then name", () => {
    const notes = [note(["home", "work"]), note(["home"]), note(["alpha"]), note([])];

    const index = indexTags(notes);

    expect(index.tags.map(({ name, count }) => [name, count])).toEqual([
      ["home", 2],
      ["alpha", 1],
      ["work", 1],
    ]);
    expect(index.byKey.get("home")?.noteIds).toEqual([notes[0].id, notes[1].id]);
  });

  it("is empty for notes without tags", () => {
    expect(indexTags([note([]), note([])]).tags).toEqual([]);
  });

  it("merges casings into one tag, keeping the casing the oldest note used", () => {
    const index = indexTags([
      note(["WORK"], "2026-03-01T00:00:00.000Z"),
      note(["Work"], "2026-01-01T00:00:00.000Z"),
      note(["work"], null),
    ]);

    expect(index.tags).toMatchObject([{ key: "work", name: "Work", count: 3 }]);
  });

  it("counts a note once however many ways it spells a tag", () => {
    const index = indexTags([note(["Home", "home", "HOME"])]);

    expect(index.tags).toMatchObject([{ name: "Home", count: 1 }]);
  });

  it("sorts names naturally, ignoring case", () => {
    const index = indexTags([note(["Zebra", "apple", "tag 10", "tag 2", "Été"])]);

    expect(index.tags.map(({ name }) => name)).toEqual(["apple", "Été", "tag 2", "tag 10", "Zebra"]);
  });

  it("keeps the casing already in use for tags typed again", () => {
    const index = indexTags([note(["Reading list"])]);

    expect(canonicalTags(["READING   LIST", "new", " New "], index)).toEqual(["Reading list", "new"]);
  });
});

describe("tags: filtering", () => {
  const notes = [note(["home", "work"]), note(["Home"]), note(["work"]), note([])];

  it("keeps every note when nothing is selected", () => {
    expect(filterByTags(notes, [])).toEqual(notes);
  });

  it("keeps the notes that carry every selected tag, whatever its casing", () => {
    expect(filterByTags(notes, ["HOME"]).map((n) => n.id)).toEqual([notes[0].id, notes[1].id]);
    expect(filterByTags(notes, ["home", "work"]).map((n) => n.id)).toEqual([notes[0].id]);
    expect(filterByTags(notes, ["home", "missing"])).toEqual([]);
  });
});
