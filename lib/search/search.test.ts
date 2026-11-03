import { describe, expect, it } from "vitest";
import { createNoteIndex, type SearchableNote } from ".";

let counter = 0;
/** A note as the device store shows it, with the fields the index reads. */
function note(
  title: string,
  body = "",
  options: { notebook?: string; folder?: string; tags?: string[]; id?: string } = {},
): SearchableNote {
  return {
    id: options.id ?? `id-${++counter}`,
    notebook: options.notebook ?? "mira/my-notes",
    folder: options.folder ?? "",
    title,
    body,
    tags: options.tags ?? [],
  };
}

const indexOf = (...notes: SearchableNote[]) => {
  const index = createNoteIndex();
  for (const entry of notes) index.add(entry);
  return index;
};

const text = (segments: { text: string; marked: boolean }[]) =>
  segments.map((segment) => (segment.marked ? `[${segment.text}]` : segment.text)).join("");

describe("searching notes", () => {
  it("finds text in titles, bodies and tags, across notebooks", () => {
    const index = indexOf(
      note("Garden plan", "Raised beds along the south fence.", { folder: "Projects/Garden" }),
      note("Shopping", "Cedar boards, 2 m.\nScrews.", { notebook: "mira/my-notes" }),
      note("Team offsite", "Agenda to follow.", { notebook: "northwind/team-notes", tags: ["travel", "cedar-lodge"] }),
      note("Unrelated", "Nothing here."),
    );

    expect(index.search("garden").map((result) => result.title)).toEqual(["Garden plan"]);
    expect(index.search("screws").map((result) => result.title)).toEqual(["Shopping"]);
    expect(index.search("travel").map((result) => result.title)).toEqual(["Team offsite"]);
    expect(index.search("cedar").map((result) => [result.title, result.notebook]).sort()).toEqual([
      ["Shopping", "mira/my-notes"],
      ["Team offsite", "northwind/team-notes"],
    ]);
  });

  it("lists title matches first, by prefix and with a typo, then matches in the text", () => {
    const index = indexOf(
      note("Notes on cedar", "Nothing about wood here."),
      note("Fence", "Cedar posts last longest."),
      note("Cedr shingles", "Roofing."),
    );

    const results = index.search("cedar");
    expect(results.map((result) => [result.title, result.kind])).toEqual([
      ["Notes on cedar", "title"],
      ["Cedr shingles", "title"],
      ["Fence", "text"],
    ]);
    expect(index.search("ced").map((result) => result.title)).toContain("Notes on cedar");
  });

  it("needs every word of the query, in any field", () => {
    const index = indexOf(note("Cedar", "Raised beds."), note("Pine", "Raised beds."), note("Cedar beds", ""));

    expect(index.search("cedar beds").map((result) => result.title)).toEqual(["Cedar beds", "Cedar"]);
  });

  it("carries a snippet of the first matching line, with the match marked, and the note's folder path", () => {
    const index = indexOf(
      note("Garden plan", "# Plan\n\nRaised beds along the south fence.\nCedar for the beds.", {
        notebook: "mira/my-notes",
        folder: "Projects/Garden",
      }),
      note("Lodge", "Nothing in the body.", { tags: ["cedar-lodge", "travel"], folder: "Trips" }),
    );

    const results = index.search("cedar");
    const plan = results.find((result) => result.title === "Garden plan")!;
    const lodge = results.find((result) => result.title === "Lodge")!;
    expect(plan.kind).toBe("text");
    expect(text(plan.snippet!)).toBe("[Cedar] for the beds.");
    expect(plan.path).toEqual(["my-notes", "Projects", "Garden"]);
    // A match in the tags alone shows the tags.
    expect(text(lodge.snippet!)).toBe("#[cedar-lodge] #travel");
    expect(lodge.path).toEqual(["my-notes", "Trips"]);
  });

  it("marks the matched part of a title", () => {
    const index = indexOf(note("Notes on cedar fences", ""));

    const [result] = index.search("ced");
    expect(text(result.titleSegments)).toBe("Notes on [cedar] fences");
  });

  it("returns nothing for an empty query and at most the limit asked for", () => {
    const index = indexOf(...Array.from({ length: 10 }, (_, i) => note(`Entry ${i}`, "Shared words.")));

    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
    expect(index.search("shared", { limit: 4 })).toHaveLength(4);
    expect(index.search("shared")).toHaveLength(10);
  });
});

describe("keeping the index up to date", () => {
  it("follows an edit, a rename and a deletion", () => {
    const index = indexOf(note("Draft", "First words.", { id: "a" }));

    index.replace(note("Draft", "Second words.", { id: "a" }));
    expect(index.search("first")).toEqual([]);
    expect(index.search("second").map((result) => result.id)).toEqual(["a"]);

    index.replace(note("Final", "Second words.", { id: "a" }));
    expect(index.search("draft")).toEqual([]);
    expect(index.search("final").map((result) => result.id)).toEqual(["a"]);

    index.remove("a");
    expect(index.search("final")).toEqual([]);
    expect(index.search("second")).toEqual([]);
  });

  it("takes the device store's new state and changes only what changed", () => {
    const index = createNoteIndex();
    const a = note("Alpha", "One.", { id: "a" });
    const b = note("Beta", "Two.", { id: "b" });
    index.update(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
    expect(index.search("one").map((result) => result.id)).toEqual(["a"]);

    // The same object for a, a new one for b, and c is new; a is untouched.
    const next = new Map([
      ["a", a],
      ["b", note("Beta", "Three.", { id: "b" })],
      ["c", note("Gamma", "Four.", { id: "c" })],
    ]);
    index.update(next);
    expect(index.search("two")).toEqual([]);
    expect(index.search("three").map((result) => result.id)).toEqual(["b"]);
    expect(index.search("four").map((result) => result.id)).toEqual(["c"]);

    index.update(new Map([["c", next.get("c")!]]));
    expect(index.search("one")).toEqual([]);
    expect(index.search("three")).toEqual([]);
    expect(index.search("four").map((result) => result.id)).toEqual(["c"]);
    expect(index.size).toBe(1);
  });
});

describe("with over a thousand notes", () => {
  it("indexes on load and answers each keystroke well inside a frame", () => {
    const folders = ["", "Work", "Work/Clients/Northwind", "日記", "Archive/2024/Q1"];
    const words = ["garden", "cedar", "invoice", "agenda", "ferry", "北海道", "émigré", "quarterly"];
    const notes = new Map<string, SearchableNote>();
    for (let i = 0; i < 1_200; i++) {
      const body = Array.from({ length: 40 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ") + `\nLine ${i}.`;
      const entry = note(`Note ${i} ${words[i % words.length]}`, body, {
        folder: folders[i % folders.length],
        tags: [words[(i + 1) % words.length]],
        id: `n${i}`,
      });
      notes.set(entry.id, entry);
    }

    const index = createNoteIndex();
    const started = performance.now();
    index.update(notes);
    const built = performance.now() - started;
    expect(index.size).toBe(1_200);

    const keystrokes = ["c", "ce", "ced", "ceda", "cedar", "cedar g", "cedar ga", "北", "北海", "line 1", "line 11", "quart"];
    let slowest = 0;
    for (const query of keystrokes) {
      const before = performance.now();
      const results = index.search(query, { limit: 50 });
      slowest = Math.max(slowest, performance.now() - before);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(50);
    }
    // A frame is 16 ms; the budget is generous so a slow test runner doesn't fail the build.
    expect(slowest).toBeLessThan(100);
    expect(built).toBeLessThan(2_000);
  });
});
