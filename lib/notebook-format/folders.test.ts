import { describe, expect, it } from "vitest";
import {
  folderKeepPath,
  folderName,
  folderOfKeepPath,
  isInFolder,
  isInsideOrSelf,
  movedPath,
  sanitizeFolderName,
  uniqueFolderName,
} from ".";

describe("notebook format: folders are directories", () => {
  it("marks an empty folder with a .gitkeep, and reads the folder back from it", () => {
    expect(folderKeepPath("Projects/Garden")).toBe("Projects/Garden/.gitkeep");
    expect(folderOfKeepPath("Projects/Garden/.gitkeep")).toBe("Projects/Garden");
    expect(folderOfKeepPath("Projects/.gitkeep")).toBe("Projects");
  });

  it("ignores .gitkeep files that mark nothing a member sees", () => {
    // The notebook's root needs no marker; attachments and hidden directories aren't folders.
    expect(folderOfKeepPath(".gitkeep")).toBeNull();
    expect(folderOfKeepPath("attachments/.gitkeep")).toBeNull();
    expect(folderOfKeepPath(".trash/Projects/.gitkeep")).toBeNull();
    expect(folderOfKeepPath("Projects/.hidden/.gitkeep")).toBeNull();
    expect(folderOfKeepPath("Projects/Garden/Plan.md")).toBeNull();
    expect(folderOfKeepPath("Projects/gitkeep")).toBeNull();
  });

  it("names a folder by its last segment", () => {
    expect(folderName("Projects/Garden")).toBe("Garden");
    expect(folderName("Projects")).toBe("Projects");
    expect(folderName("notes.md")).toBe("notes.md");
  });

  it("tells what is inside a folder, at any depth, and the top level holds everything", () => {
    expect(isInFolder("Projects/Garden/Plan.md", "Projects")).toBe(true);
    expect(isInFolder("Projects/Garden", "Projects")).toBe(true);
    expect(isInFolder("Projects/Garden/Plan.md", "Projects/Garden")).toBe(true);
    expect(isInFolder("Projects/Garden/Plan.md", "Projects/Gar")).toBe(false);
    expect(isInFolder("Projects", "Projects")).toBe(false);
    expect(isInFolder("Plan.md", "")).toBe(true);
    expect(isInFolder("Projects/Plan.md", "")).toBe(true);
  });

  it("knows a folder is inside itself, for refusing to move one into its own descendants", () => {
    expect(isInsideOrSelf("Projects", "Projects")).toBe(true);
    expect(isInsideOrSelf("Projects/Garden/Beds", "Projects")).toBe(true);
    expect(isInsideOrSelf("Projects", "Projects/Garden")).toBe(false);
    expect(isInsideOrSelf("Projects 2", "Projects")).toBe(false);
    expect(isInsideOrSelf("", "")).toBe(true);
    expect(isInsideOrSelf("Projects", "")).toBe(true);
  });

  it("moves a path along with its folder, to another folder or the top level", () => {
    expect(movedPath("Projects/Garden/Plan.md", "Projects/Garden", "Archive/Garden")).toBe("Archive/Garden/Plan.md");
    expect(movedPath("Projects/Garden/Beds/.gitkeep", "Projects", "Old")).toBe("Old/Garden/Beds/.gitkeep");
    expect(movedPath("Projects/Garden/Plan.md", "Projects", "")).toBe("Garden/Plan.md");
    expect(movedPath("Plan.md", "", "Archive")).toBe("Archive/Plan.md");
    expect(movedPath("Projects/Garden", "Projects/Garden", "Allotment")).toBe("Allotment");
  });

  it("sanitises a folder name like a title, falling back to New folder", () => {
    expect(sanitizeFolderName("  Garden / Beds  ")).toBe("Garden - Beds");
    expect(sanitizeFolderName("...")).toBe("New folder");
    expect(sanitizeFolderName("")).toBe("New folder");
    expect(sanitizeFolderName(".trash")).toBe("trash");
    expect(sanitizeFolderName("日記 🌱")).toBe("日記 🌱");
  });

  it("de-duplicates a folder name among its siblings, ignoring case, and keeps attachments free at the top level", () => {
    expect(uniqueFolderName("Garden", "Projects", ["garden", "Garden 2"])).toBe("Garden 3");
    expect(uniqueFolderName("Garden", "Projects", ["Beds"])).toBe("Garden");
    expect(uniqueFolderName("Attachments", "", [])).toBe("Attachments 2");
    expect(uniqueFolderName("attachments", "Projects", [])).toBe("attachments");
  });
});
