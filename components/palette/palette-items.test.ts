import { describe, expect, it } from "vitest";
import { matchesAction } from "./palette-items";

describe("matchesAction", () => {
  const action = { id: "toggle-mode", label: "Switch to source mode", keywords: "toggle markdown rich text" };

  it("lists every action for an empty query", () => {
    expect(matchesAction(action, "")).toBe(true);
    expect(matchesAction(action, "  ")).toBe(true);
  });

  it("matches each word of the query against the start of a word in the label or keywords, in any case", () => {
    expect(matchesAction(action, "sou")).toBe(true);
    expect(matchesAction(action, "Source Mode")).toBe(true);
    expect(matchesAction(action, "toggle")).toBe(true);
    expect(matchesAction(action, "mark sw")).toBe(true);
    expect(matchesAction(action, "ource")).toBe(false);
    expect(matchesAction(action, "source garden")).toBe(false);
  });
});
