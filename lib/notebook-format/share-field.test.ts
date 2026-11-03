import { describe, expect, it } from "vitest";
import { readNote, writeNote } from ".";

const shareId = "Qm9vGhIjKlMnOpQrStUvWx";

const written = ["---", "id: 3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e", "tags: [home]", "updated: 2026-11-03T12:30:00.000Z", "---", "Body", ""].join(
  "\n",
);

describe("notebook format: the share field", () => {
  it("reads a share id from the frontmatter, and none when there isn't one", () => {
    expect(readNote(written).share).toBeNull();
    expect(readNote(written.replace("tags: [home]\n", `tags: [home]\nshare: ${shareId}\n`)).share).toBe(shareId);
    expect(readNote("No frontmatter\n").share).toBeNull();
  });

  it("adds the share id after the app's other keys, changing nothing else", () => {
    expect(writeNote(written, { share: shareId })).toBe(
      written.replace("updated: 2026-11-03T12:30:00.000Z\n", `updated: 2026-11-03T12:30:00.000Z\nshare: ${shareId}\n`),
    );
  });

  it("writes an unchanged share id byte for byte", () => {
    const shared = writeNote(written, { share: shareId });
    expect(writeNote(shared, { share: shareId })).toBe(shared);
    expect(writeNote(shared, {})).toBe(shared);
    expect(writeNote(shared, { share: null })).toBe(shared);
  });

  it("removes the key when the share id is cleared, leaving every other line as it was", () => {
    const shared = [
      "---",
      "id: 3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e",
      `share: ${shareId}   # the link`,
      "# a comment",
      "tags: [home]",
      "---",
      "Body",
      "",
    ].join("\n");
    expect(writeNote(shared, { share: "" })).toBe(
      ["---", "id: 3f0c6a8e-6a43-4c55-9d0b-1f6f2f8f5b1e", "# a comment", "tags: [home]", "---", "Body", ""].join("\n"),
    );
    expect(writeNote(written, { share: "" })).toBe(written);
  });

  it("clears a share id written with Windows line endings", () => {
    const shared = `---\r\nid: abc\r\nshare: ${shareId}\r\n---\r\nBody\r\n`;
    expect(writeNote(shared, { share: "" })).toBe("---\r\nid: abc\r\n---\r\nBody\r\n");
  });

  it("gives a file without frontmatter one when it is first shared", () => {
    expect(writeNote("Body\n", { id: "abc", share: shareId })).toBe(`---\nid: abc\nshare: ${shareId}\n---\nBody\n`);
  });
});
