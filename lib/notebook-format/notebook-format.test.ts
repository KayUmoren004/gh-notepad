import { describe, expect, it } from "vitest";
import {
  folderOfPath,
  isNotePath,
  isSafePath,
  notePath,
  readNote,
  sanitizeTitle,
  titleOfPath,
  uniqueTitle,
  writeNote,
} from ".";

/** Files as they might be found in a notebook: written by the app, by hand, or by other tools. */
const corpus: Record<string, string> = {
  "written by the app": [
    "---",
    "id: 3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e",
    "tags: [groceries, home]",
    "created: 2026-11-03T12:00:00.000Z",
    "updated: 2026-11-03T12:30:00.000Z",
    "---",
    "# Groceries",
    "",
    "- Milk",
    "- Bread",
    "",
  ].join("\n"),
  "hand-written frontmatter with comments, unknown keys and odd spacing": [
    "---",
    "# kept by Obsidian",
    "id:   'abc-123'",
    "aliases:",
    "  - Shopping",
    "tags:",
    "  - groceries",
    "cssclass: wide   # trailing comment",
    "",
    "---",
    "",
    "Body after a blank line.",
  ].join("\n"),
  "Windows line endings": "---\r\nid: crlf-note\r\ntags: []\r\n---\r\nLine one\r\nLine two\r\n",
  "a byte order mark": "﻿---\nid: bom-note\n---\nBody\n",
  "no frontmatter": "# Written on github.com\n\nNo metadata here.\n",
  "frontmatter closed with dots": "---\nid: dots\n...\nBody\n",
  "only frontmatter, no final newline": "---\nid: empty\ntags: []\n---",
  "an empty file": "",
  "a horizontal rule that is not frontmatter": "Intro\n\n---\n\nid: not-frontmatter\n---\n",
  "an unclosed frontmatter fence": "---\nid: never-closed\nBody\n",
  "frontmatter that isn't valid YAML": "---\nid: [unclosed\ntags: : :\n---\nBody survives\n",
  "frontmatter that is a list, not a mapping": "---\n- one\n- two\n---\nBody\n",
  "non-Latin text and emoji": "---\nid: 多言語\ntags: [日本語, 🍕]\n---\nこんにちは 👋🏽\n",
};

describe("notebook format: an unchanged note round-trips byte for byte", () => {
  for (const [name, text] of Object.entries(corpus)) {
    it(name, () => {
      expect(writeNote(text, readNote(text))).toBe(text);
      expect(writeNote(text, {})).toBe(text);
    });
  }
});

describe("notebook format: reading a note", () => {
  it("reads the app's frontmatter fields and the body after it", () => {
    expect(readNote(corpus["written by the app"])).toEqual({
      id: "3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e",
      tags: ["groceries", "home"],
      created: "2026-11-03T12:00:00.000Z",
      updated: "2026-11-03T12:30:00.000Z",
      share: null,
      trashed: null,
      body: "# Groceries\n\n- Milk\n- Bread\n",
    });
  });

  it("accepts a file without frontmatter as all body", () => {
    expect(readNote(corpus["no frontmatter"])).toEqual({
      id: null,
      tags: [],
      created: null,
      updated: null,
      share: null,
      trashed: null,
      body: "# Written on github.com\n\nNo metadata here.\n",
    });
  });

  it("treats frontmatter it can't parse as having no fields, keeping the body", () => {
    expect(readNote(corpus["frontmatter that isn't valid YAML"])).toMatchObject({ id: null, body: "Body survives\n" });
  });

  it("reads block-style tags and quoted ids", () => {
    expect(readNote(corpus["hand-written frontmatter with comments, unknown keys and odd spacing"])).toMatchObject({
      id: "abc-123",
      tags: ["groceries"],
      body: "\nBody after a blank line.",
    });
  });
});

describe("notebook format: writing changes", () => {
  it("rewrites only the lines that changed, keeping comments, spacing and unknown keys", () => {
    const text = corpus["hand-written frontmatter with comments, unknown keys and odd spacing"];

    const written = writeNote(text, { body: "\nEdited.", updated: "2026-11-04T09:00:00.000Z" });

    expect(written).toBe(
      [
        "---",
        "# kept by Obsidian",
        "id:   'abc-123'",
        "aliases:",
        "  - Shopping",
        "tags:",
        "  - groceries",
        "cssclass: wide   # trailing comment",
        "",
        "updated: 2026-11-04T09:00:00.000Z",
        "---",
        "",
        "Edited.",
      ].join("\n"),
    );
  });

  it("replaces an existing value in place", () => {
    const written = writeNote(corpus["written by the app"], { updated: "2026-11-04T09:00:00.000Z" });

    expect(written).toBe(
      corpus["written by the app"].replace("updated: 2026-11-03T12:30:00.000Z", "updated: 2026-11-04T09:00:00.000Z"),
    );
  });

  it("gives a file without frontmatter one the first time metadata is written", () => {
    const written = writeNote(corpus["no frontmatter"], {
      id: "new-id",
      tags: [],
      created: "2026-11-04T09:00:00.000Z",
      updated: "2026-11-04T09:00:00.000Z",
    });

    // An empty tag list is the same as none, so it isn't written.
    expect(written).toBe(
      [
        "---",
        "id: new-id",
        "created: 2026-11-04T09:00:00.000Z",
        "updated: 2026-11-04T09:00:00.000Z",
        "---",
        "# Written on github.com",
        "",
        "No metadata here.",
        "",
      ].join("\n"),
    );
  });

  it("keeps Windows line endings when it adds a key", () => {
    const written = writeNote(corpus["Windows line endings"], { updated: "2026-11-04T09:00:00.000Z" });

    expect(written).toBe("---\r\nid: crlf-note\r\ntags: []\r\nupdated: 2026-11-04T09:00:00.000Z\r\n---\r\nLine one\r\nLine two\r\n");
  });

  it("quotes values YAML would otherwise read as something else", () => {
    const written = writeNote("", { id: "12345", tags: ["true", "a: b", "plain"] });

    expect(written).toBe('---\nid: "12345"\ntags: ["true", "a: b", plain]\n---\n');
    expect(readNote(written)).toMatchObject({ id: "12345", tags: ["true", "a: b", "plain"] });
  });

  it("leaves frontmatter it can't parse untouched, while still saving the body", () => {
    const written = writeNote(corpus["frontmatter that isn't valid YAML"], { id: "new-id", body: "Edited\n" });

    expect(written).toBe("---\nid: [unclosed\ntags: : :\n---\nEdited\n");
  });

  it("starts the body on its own line after frontmatter that ended the file", () => {
    const written = writeNote(corpus["only frontmatter, no final newline"], { body: "Now with a body" });

    expect(written).toBe("---\nid: empty\ntags: []\n---\nNow with a body");
  });
});

describe("notebook format: titles are file names", () => {
  it("places a note at <folder>/<title>.md and reads the title and folder back", () => {
    expect(notePath("", "Groceries")).toBe("Groceries.md");
    expect(notePath("Recipes/Italian", "Pizza")).toBe("Recipes/Italian/Pizza.md");
    expect(titleOfPath("Recipes/Italian/Pizza.md")).toBe("Pizza");
    expect(folderOfPath("Recipes/Italian/Pizza.md")).toBe("Recipes/Italian");
    expect(folderOfPath("Pizza.md")).toBe("");
    expect(titleOfPath("Notes/Release v1.2.md")).toBe("Release v1.2");
  });

  it.each([
    ["Groceries", "Groceries"],
    ["Q1/Q2 plans", "Q1-Q2 plans"],
    ["back\\slash", "back-slash"],
    ['Meeting: "Q3" <draft> | v2? *', "Meeting- -Q3- -draft- - v2- -"],
    ["  padded title  ", "padded title"],
    ["Ends with dots...", "Ends with dots"],
    [".hidden", "hidden"],
    ["Line\nbreak\tand tab", "Line break and tab"],
    ["", "Untitled"],
    ["   ", "Untitled"],
    ["...", "Untitled"],
    ["CON", "CON_"],
    ["nul.txt", "nul_.txt"],
    ["Console", "Console"],
    ["Cafe\u0301", "Caf\u00e9"],
    ["🍕 Pizza night", "🍕 Pizza night"],
    ["日本語のノート", "日本語のノート"],
  ])("sanitises %j to %j", (raw, title) => {
    expect(sanitizeTitle(raw)).toBe(title);
  });

  it("caps long titles to a safe file name length without splitting characters", () => {
    const long = "👩🏽‍💻".repeat(100);

    const title = sanitizeTitle(long);

    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(200);
    expect(title.length).toBeGreaterThan(0);
    expect(title).toBe("👩🏽‍💻".repeat(title.length / "👩🏽‍💻".length));
  });

  it("de-duplicates a title within a folder by appending 2, 3, …, ignoring case", () => {
    expect(uniqueTitle("Groceries", [])).toBe("Groceries");
    expect(uniqueTitle("Groceries", ["Groceries"])).toBe("Groceries 2");
    expect(uniqueTitle("Groceries", ["groceries", "Groceries 2"])).toBe("Groceries 3");
    expect(uniqueTitle("Untitled", ["Untitled", "Untitled 3"])).toBe("Untitled 2");
  });
});

describe("notebook format: which files are notes", () => {
  it.each([
    ["Groceries.md", true],
    ["Recipes/Italian/Pizza.md", true],
    ["README.md", true],
    ["Shouty.MD", true],
    ["notes/3f0c.json", false],
    ["metadata.json", false],
    [".trash/Groceries.md", false],
    [".github/ISSUE_TEMPLATE.md", false],
    ["Recipes/.gitkeep", false],
    ["attachments/diagram.md", false],
    ["Recipes/.draft.md", false],
  ])("%s is a note: %s", (path, expected) => {
    expect(isNotePath(path)).toBe(expected);
  });

  it.each([
    ["Groceries.md", true],
    ["Recipes/Italian/Pizza.md", true],
    [".trash/Recipes/Pizza.md", true],
    ["attachments/2026/photo.png", true],
    ["", false],
    ["/etc/passwd", false],
    ["Recipes/../../escape.md", false],
    ["./Groceries.md", false],
    ["Recipes//Pizza.md", false],
    [".git/config", false],
    ["Recipes/.GIT/hooks", false],
    ["back\\slash.md", false],
    ["control\u0000char.md", false],
    ["trailing/", false],
  ])("%j is a safe notebook path: %s", (path, expected) => {
    expect(isSafePath(path)).toBe(expected);
  });
});
