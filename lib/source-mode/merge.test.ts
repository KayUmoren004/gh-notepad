import { describe, expect, test } from "vitest";
import { mergeIncoming } from "./merge";

const base = "# Plan\n\nFirst paragraph.\n\nLast paragraph.\n";

describe("a change from elsewhere while the member is typing in source mode", () => {
  test("with nothing typed, the incoming text is taken as it is", () => {
    expect(mergeIncoming(base, base, `Intro.\n\n${base}`)).toBe(`Intro.\n\n${base}`);
  });

  test("typing on other lines is kept alongside the incoming change", () => {
    const typed = base.replace("Last paragraph.", "Last paragraph, revised.");
    expect(mergeIncoming(typed, base, `Intro.\n\n${base}`)).toBe(`Intro.\n\n${typed}`);
  });

  test("where both changed the same lines, the typing wins", () => {
    const typed = base.replace("First paragraph.", "First paragraph, mine.");
    const incoming = base.replace("First paragraph.", "First paragraph, theirs.");
    expect(mergeIncoming(typed, base, incoming)).toBe(typed);
  });
});
