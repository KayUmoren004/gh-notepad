import { describe, expect, it } from "vitest";
import { migrateV1 } from ".";

/** A v1 note file as v1 wrote it: `JSON.stringify(note, null, 2)` at `notes/<id>.json`. */
function v1Note(fields: Record<string, unknown>): { path: string; text: string } {
  return { path: `notes/${String(fields.id)}.json`, text: JSON.stringify(fields, null, 2) };
}

function v1Metadata(fields: Record<string, unknown>): { path: string; text: string } {
  return { path: "metadata.json", text: JSON.stringify(fields, null, 2) };
}

describe("v1 migration: missing fields", () => {
  it("fills in what a v1 note lacks: the id from its file name, an Untitled title, the top level", () => {
    const migration = migrateV1([{ path: "notes/5e6f7a8b.json", text: '{ "content": "Just a body\\n" }' }]);

    expect(migration.notes).toEqual([{ id: "5e6f7a8b", path: "Untitled.md", text: "---\nid: 5e6f7a8b\n---\nJust a body\n" }]);
    expect(migration.skipped).toEqual([]);
  });

  it("treats fields of the wrong type, and empty ones, as missing", () => {
    const migration = migrateV1([
      {
        path: "notes/c3.json",
        text: JSON.stringify({
          id: 42,
          title: ["not", "a", "title"],
          content: null,
          folder: "   ",
          tags: "work",
          createdAt: "",
          updatedAt: 1704067200000,
        }),
      },
      { path: "notes/d4.json", text: JSON.stringify({ title: "Tagged", tags: ["a", 7, "", " b ", "a", null] }) },
    ]);

    expect(migration.notes).toEqual([
      { id: "c3", path: "Untitled.md", text: "---\nid: c3\n---\n" },
      { id: "d4", path: "Tagged.md", text: "---\nid: d4\ntags: [a, b]\n---\n" },
    ]);
  });

  it("reads a metadata.json without folders as having none", () => {
    const migration = migrateV1([{ path: "metadata.json", text: '{ "tags": [] }' }]);

    expect(migration).toEqual({ notes: [], folders: [], removed: ["metadata.json"], skipped: [] });
  });
});

describe("v1 migration: duplicate titles", () => {
  it("de-duplicates titles within a folder, ignoring case; the oldest note keeps the plain title", () => {
    const note = (id: string, title: string, folder: string | null, createdAt: string) =>
      v1Note({ id, title, content: "", folder, tags: [], createdAt, updatedAt: createdAt });
    const migration = migrateV1([
      note("b", "Plan", "Work", "2024-03-01T00:00:00.000Z"),
      note("a", "Plan", "Work", "2024-01-01T00:00:00.000Z"),
      note("c", "plan", "Work", "2024-02-01T00:00:00.000Z"),
      note("d", "Plan", null, "2024-04-01T00:00:00.000Z"),
      note("e", "Q1/Q2", null, "2024-05-01T00:00:00.000Z"),
      note("f", "Q1-Q2", null, "2024-06-01T00:00:00.000Z"),
    ]);

    expect(Object.fromEntries(migration.notes.map(({ id, path }) => [id, path]))).toEqual({
      a: "Work/Plan.md",
      c: "Work/plan 2.md",
      b: "Work/Plan 3.md",
      d: "Plan.md",
      e: "Q1-Q2.md",
      f: "Q1-Q2 2.md",
    });
  });

  it("never takes the place of a note the notebook already has", () => {
    const migration = migrateV1(
      [
        v1Note({ id: "a", title: "README", content: "", folder: null, tags: [], createdAt: "", updatedAt: "" }),
        v1Note({ id: "b", title: "Ideas", content: "", folder: "Work", tags: [], createdAt: "", updatedAt: "" }),
      ],
      [
        { path: "README.md", text: "# my-notes\n" },
        { path: "Work/ideas.md", text: "Written in v2\n" },
      ],
    );

    expect(migration.notes.map((note) => note.path)).toEqual(["README 2.md", "Work/Ideas 2.md"]);
  });
});

describe("v1 migration: malformed files", () => {
  it("skips files it can't read and reports why, converting everything else", () => {
    const migration = migrateV1([
      { path: "metadata.json", text: '{ "folders": ["Work", ' },
      { path: "notes/truncated.json", text: '{ "id": "truncated", "title": "Half a no' },
      { path: "notes/list.json", text: '["not", "a", "note"]' },
      { path: "notes/null.json", text: "null" },
      { path: "notes/empty.json", text: "" },
      v1Note({ id: "fine", title: "Fine", content: "Still here\n", folder: "Work", tags: [], createdAt: "", updatedAt: "" }),
    ]);

    expect(migration.notes).toEqual([{ id: "fine", path: "Work/Fine.md", text: "---\nid: fine\n---\nStill here\n" }]);
    expect(migration.skipped).toEqual([
      { path: "metadata.json", reason: "isn't valid JSON" },
      { path: "notes/empty.json", reason: "isn't valid JSON" },
      { path: "notes/list.json", reason: "isn't a v1 note" },
      { path: "notes/null.json", reason: "isn't a v1 note" },
      { path: "notes/truncated.json", reason: "isn't valid JSON" },
    ]);
    // Unreadable files go too: the notebook's history keeps them, and the migration doesn't run again.
    expect(migration.removed).toEqual([
      "metadata.json",
      "notes/empty.json",
      "notes/fine.json",
      "notes/list.json",
      "notes/null.json",
      "notes/truncated.json",
    ]);
  });

  it("reports a metadata.json that isn't v1's", () => {
    const migration = migrateV1([{ path: "metadata.json", text: '"folders"' }]);

    expect(migration.skipped).toEqual([{ path: "metadata.json", reason: "isn't v1 metadata" }]);
  });
});

describe("v1 migration: running again", () => {
  it("doesn't convert a note again once the notebook has it, nor keep its folder as empty", () => {
    const v1 = [
      v1Metadata({ folders: ["Work"], tags: [] }),
      v1Note({ id: "a", title: "Plan", content: "", folder: "Work", tags: [], createdAt: "", updatedAt: "" }),
      v1Note({ id: "b", title: "Later", content: "", folder: null, tags: [], createdAt: "", updatedAt: "" }),
    ];
    const first = migrateV1(v1);
    // Interrupted after the first note's file reached the notebook (or this device).
    const again = migrateV1(v1, [first.notes[0], { path: "README.md", text: "# my-notes\n" }]);

    expect(again.notes).toEqual([first.notes[1]]);
    expect(again.folders).toEqual([]);
    expect(again.removed).toEqual(first.removed);
    expect(migrateV1(v1, first.notes).notes).toEqual([]);
  });

  it("gives a copied v1 file carrying another note's id its own id, from its file name", () => {
    const original = v1Note({ id: "a", title: "Plan", content: "1\n", folder: null, tags: [], createdAt: "", updatedAt: "" });
    const copy = { path: "notes/a-copy.json", text: original.text.replace('"1\\n"', '"2\\n"') };

    const migration = migrateV1([original, copy]);

    expect(migration.notes).toEqual([
      { id: "a", path: "Plan.md", text: "---\nid: a\n---\n1\n" },
      { id: "a-copy", path: "Plan 2.md", text: "---\nid: a-copy\n---\n2\n" },
    ]);
    expect(migrateV1([original, copy], migration.notes).notes).toEqual([]);
  });
});

describe("v1 migration: typical v1 data", () => {
  it("turns each v1 note into <folder>/<title>.md, carrying its id, tags and timestamps in frontmatter", () => {
    const migration = migrateV1([
      v1Metadata({ folders: ["Work"], tags: [{ name: "urgent", color: "#ef4444" }] }),
      v1Note({
        id: "0b9e2c1a-5d7f-4a8e-9c3b-2f1e0d9c8b7a",
        title: "Groceries",
        content: "- Milk\n- Bread\n",
        folder: null,
        tags: [],
        createdAt: "2024-01-01T09:00:00.000Z",
        updatedAt: "2024-01-02T18:30:00.000Z",
      }),
      v1Note({
        id: "7c4d1f2e-3b6a-4c9d-8e1f-0a2b3c4d5e6f",
        title: "Roadmap",
        content: "# Q1\n\nShip **v2**.",
        folder: "Work",
        tags: ["urgent", "planning"],
        createdAt: "2024-02-01T10:00:00.000Z",
        updatedAt: "2024-02-03T11:15:00.000Z",
      }),
    ]);

    expect(migration.notes).toEqual([
      {
        id: "0b9e2c1a-5d7f-4a8e-9c3b-2f1e0d9c8b7a",
        path: "Groceries.md",
        text: [
          "---",
          "id: 0b9e2c1a-5d7f-4a8e-9c3b-2f1e0d9c8b7a",
          "created: 2024-01-01T09:00:00.000Z",
          "updated: 2024-01-02T18:30:00.000Z",
          "---",
          "- Milk",
          "- Bread",
          "",
        ].join("\n"),
      },
      {
        id: "7c4d1f2e-3b6a-4c9d-8e1f-0a2b3c4d5e6f",
        path: "Work/Roadmap.md",
        text: [
          "---",
          "id: 7c4d1f2e-3b6a-4c9d-8e1f-0a2b3c4d5e6f",
          "tags: [urgent, planning]",
          "created: 2024-02-01T10:00:00.000Z",
          "updated: 2024-02-03T11:15:00.000Z",
          "---",
          "# Q1",
          "",
          "Ship **v2**.",
        ].join("\n"),
      },
    ]);
    expect(migration.removed).toEqual([
      "metadata.json",
      "notes/0b9e2c1a-5d7f-4a8e-9c3b-2f1e0d9c8b7a.json",
      "notes/7c4d1f2e-3b6a-4c9d-8e1f-0a2b3c4d5e6f.json",
    ]);
    expect(migration.skipped).toEqual([]);
  });

  it("keeps folders that hold no notes as empty folders, each with a .gitkeep", () => {
    const migration = migrateV1([
      v1Metadata({ folders: ["Work", "Recipes", "Travel plans"], tags: [] }),
      v1Note({ id: "a1", title: "Roadmap", content: "", folder: "Work", tags: [], createdAt: "", updatedAt: "" }),
    ]);

    expect(migration.notes.map((note) => note.path)).toEqual(["Work/Roadmap.md"]);
    expect(migration.folders).toEqual(["Recipes/.gitkeep", "Travel plans/.gitkeep"]);
  });

  it("only reads v1's files: notes directly in notes/ and the root metadata.json", () => {
    const migration = migrateV1([
      { path: "README.md", text: "# my-notes\n" },
      { path: "notes/deeper/x.json", text: "{}" },
      { path: "Work/metadata.json", text: "{}" },
      v1Note({ id: "a1", title: "Only me", content: "", folder: null, tags: [], createdAt: "", updatedAt: "" }),
    ]);

    expect(migration.notes.map((note) => note.path)).toEqual(["Only me.md"]);
    expect(migration.removed).toEqual(["notes/a1.json"]);
  });
});
