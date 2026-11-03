import { describe, expect, it } from "vitest";
import { mergeNote } from "./merge";

const frontmatter = (updated: string, tags = "[]") =>
  `---\nid: 0b7c1a2e-1111-4222-8333-444455556666\ntags: ${tags}\ncreated: 2024-01-01T00:00:00.000Z\nupdated: ${updated}\n---\n`;

const base = `${frontmatter("2024-01-01T00:00:00.000Z")}Alpha\n\nBravo\n\nCharlie\n`;

describe("merging a note changed on this device and in its notebook", () => {
  it("joins edits to different lines, keeping the device's timestamps", () => {
    const device = `${frontmatter("2024-01-02T00:00:00.000Z")}Alpha, from the device\n\nBravo\n\nCharlie\n`;
    const remote = `${frontmatter("2024-01-03T00:00:00.000Z")}Alpha\n\nBravo\n\nCharlie, from the notebook\n`;

    expect(mergeNote(device, base, remote)).toEqual({
      conflict: false,
      text: `${frontmatter("2024-01-02T00:00:00.000Z")}Alpha, from the device\n\nBravo\n\nCharlie, from the notebook\n`,
    });
  });

  it("reports a conflict when both changed the same lines", () => {
    const device = `${frontmatter("2024-01-02T00:00:00.000Z")}Alpha, from the device\n\nBravo\n\nCharlie\n`;
    const remote = `${frontmatter("2024-01-03T00:00:00.000Z")}Alpha, from the notebook\n\nBravo\n\nCharlie\n`;

    expect(mergeNote(device, base, remote)).toEqual({ conflict: true });
  });

  it("is clean when both made the same change", () => {
    const device = `${frontmatter("2024-01-02T00:00:00.000Z")}Alpha!\n\nBravo\n\nCharlie\n`;
    const remote = `${frontmatter("2024-01-03T00:00:00.000Z")}Alpha!\n\nBravo\n\nCharlie\n`;

    expect(mergeNote(device, base, remote)).toEqual({ conflict: false, text: device });
  });

  it("takes the notebook's text as it is when only the notebook changed", () => {
    const remote = `${frontmatter("2024-01-03T00:00:00.000Z")}Alpha\n\nBravo, from the notebook\n\nCharlie\n`;

    expect(mergeNote(base, base, remote)).toEqual({ conflict: false, text: remote });
  });

  it("follows a metadata change made in the notebook when the device didn't touch that field", () => {
    const device = `${frontmatter("2024-01-02T00:00:00.000Z")}Alpha, from the device\n\nBravo\n\nCharlie\n`;
    const remote = `${frontmatter("2024-01-01T00:00:00.000Z", "[work, urgent]")}Alpha\n\nBravo\n\nCharlie\n`;

    expect(mergeNote(device, base, remote)).toEqual({
      conflict: false,
      text: `${frontmatter("2024-01-02T00:00:00.000Z", "[work, urgent]")}Alpha, from the device\n\nBravo\n\nCharlie\n`,
    });
  });

  it("merges files written without frontmatter", () => {
    expect(mergeNote("One\nTwo\nThree\n", "One\nTwo\n", "Zero\nOne\nTwo\n")).toEqual({
      conflict: false,
      text: "Zero\nOne\nTwo\nThree\n",
    });
  });
});
