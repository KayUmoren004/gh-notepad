import { describe, expect, it } from "vitest";
import { highlight, shortPath, snippetOf } from ".";

const text = (segments: { text: string; marked: boolean }[] | null) =>
  segments === null ? null : segments.map((segment) => (segment.marked ? `[${segment.text}]` : segment.text)).join("");

describe("highlight", () => {
  it("marks every word that starts with a matched term, whatever its case", () => {
    expect(text(highlight("Cedar beds, cedarwood and CEDAR.", ["cedar"]))).toBe("[Cedar] beds, [cedarwood] and [CEDAR].");
  });

  it("marks only whole words, and merges nothing when nothing matches", () => {
    expect(text(highlight("Encedar", ["cedar"]))).toBe("Encedar");
    expect(highlight("Plain", [])).toEqual([{ text: "Plain", marked: false }]);
  });

  it("works on scripts without spaces, emoji and accents", () => {
    expect(text(highlight("北海道の旅", ["北海道の旅"]))).toBe("[北海道の旅]");
    expect(text(highlight("🌱 émigré seeds", ["émigré"]))).toBe("🌱 [émigré] seeds");
  });
});

describe("snippetOf", () => {
  it("takes the first line that holds a match, with its Markdown markers removed", () => {
    const body = "# Plan\n\n- [ ] Order cedar\n> cedar again\n";
    expect(text(snippetOf(body, ["cedar"]))).toBe("Order [cedar]");
  });

  it("is null when no line matches", () => {
    expect(snippetOf("Nothing here.", ["cedar"])).toBeNull();
    expect(snippetOf("", ["cedar"])).toBeNull();
  });

  it("windows a long line around the first match", () => {
    const filler = "word ".repeat(60).trim();
    const body = `${filler} then cedar at last ${filler}`;
    const snippet = text(snippetOf(body, ["cedar"]))!;
    expect(snippet).toMatch(/^…word (word )*then \[cedar\] at last( word)*…$/);
    expect(snippet.length).toBeLessThan(200);
  });

  it("keeps a short line whole, and ends a cut line without splitting a word", () => {
    expect(text(snippetOf("cedar for the beds", ["cedar"]))).toBe("[cedar] for the beds");
    const long = `cedar ${"abcdefghij ".repeat(30)}`;
    const snippet = text(snippetOf(long, ["cedar"]))!;
    expect(snippet).toMatch(/^\[cedar\]( abcdefghij)+…$/);
  });
});

describe("shortPath", () => {
  it("keeps a short path whole and shows the end of a deep one", () => {
    expect(shortPath(["my-notes"])).toEqual(["my-notes"]);
    expect(shortPath(["my-notes", "Projects", "Garden"])).toEqual(["my-notes", "Projects", "Garden"]);
    expect(shortPath(["my-notes", "Archive", "2024", "Q1", "Weekly", "Last"])).toEqual(["…", "Weekly", "Last"]);
  });
});
