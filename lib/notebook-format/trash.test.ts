import { describe, expect, it } from "vitest";
import {
  folderOfTrashedKeepPath,
  isNotePath,
  isTrashedNotePath,
  originalPath,
  purgeTime,
  readNote,
  sanitizeFolderName,
  trashPath,
  TRASH_RETENTION_DAYS,
  writeNote,
} from ".";

const written = ["---", "id: abc-123", "tags: [home]", "created: 2026-11-03T12:00:00.000Z", "updated: 2026-11-03T12:30:00.000Z", "---", "Body", ""].join(
  "\n",
);
const when = "2026-11-10T09:00:00.000Z";

describe("notebook format: the Trash", () => {
  it("mirrors a path under .trash/ and back", () => {
    expect(trashPath("Garden/Plan.md")).toBe(".trash/Garden/Plan.md");
    expect(originalPath(".trash/Garden/Plan.md")).toBe("Garden/Plan.md");
    expect(originalPath("Garden/Plan.md")).toBe("Garden/Plan.md");
    expect(trashPath("")).toBe(".trash");
    expect(originalPath(".trash")).toBe("");
  });

  it("tells trashed notes and folder markers from notes, and from files that aren't either", () => {
    expect(isNotePath(".trash/Plan.md")).toBe(false);
    expect(isTrashedNotePath(".trash/Plan.md")).toBe(true);
    expect(isTrashedNotePath(".trash/Garden/Plan.md")).toBe(true);
    expect(isTrashedNotePath("Plan.md")).toBe(false);
    expect(isTrashedNotePath(".trash/attachments/x.md")).toBe(false);
    expect(isTrashedNotePath(".trash/.hidden/x.md")).toBe(false);
    expect(folderOfTrashedKeepPath(".trash/Garden/.gitkeep")).toBe(".trash/Garden");
    expect(folderOfTrashedKeepPath(".trash/Garden/Beds/.gitkeep")).toBe(".trash/Garden/Beds");
    expect(folderOfTrashedKeepPath(".trash/.gitkeep")).toBe(null);
    expect(folderOfTrashedKeepPath("Garden/.gitkeep")).toBe(null);
  });

  it("keeps .trash out of a member's reach as a folder name", () => {
    expect(sanitizeFolderName(".trash")).toBe("trash");
  });

  it("reads and writes when a note was trashed, removing the key on restore", () => {
    expect(readNote(written).trashed).toBeNull();
    const trashed = writeNote(written, { trashed: when });
    expect(trashed).toBe(written.replace("updated: 2026-11-03T12:30:00.000Z\n", `updated: 2026-11-03T12:30:00.000Z\ntrashed: ${when}\n`));
    expect(readNote(trashed).trashed).toBe(when);
    expect(writeNote(trashed, { trashed: when })).toBe(trashed);
    expect(writeNote(trashed, { trashed: "" })).toBe(written);
    expect(writeNote(written, { trashed: "" })).toBe(written);
  });

  it("purges an item thirty days after it was trashed, and never one whose date can't be read", () => {
    expect(purgeTime(when)).toBe(Date.parse(when) + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(purgeTime("")).toBeNull();
    expect(purgeTime("yesterday")).toBeNull();
  });
});
