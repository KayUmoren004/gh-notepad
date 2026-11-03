import { describe, expect, it } from "vitest";
import { checkNotebookName, notebookSlug, usernameToInvite } from "./notebook-name";

describe("a shared notebook's name", () => {
  it.each([
    ["Book club", "Book-club"],
    ["  family   trip 2026 ", "family-trip-2026"],
    ["Été à Paris!", "t-Paris"],
    ["--dashes--", "dashes"],
    ["notes.v2", "notes.v2"],
    ["日記", ""],
  ])("turns %j into the repository name %j", (typed, slug) => {
    expect(notebookSlug(typed)).toBe(slug);
  });

  it("is fine as typed when it already fits GitHub's rule", () => {
    expect(checkNotebookName("book-club")).toEqual({ slug: "book-club", problem: null });
  });

  it("says nothing until something is typed, then explains what can't become a name", () => {
    expect(checkNotebookName("   ")).toEqual({ slug: "", problem: null });
    expect(checkNotebookName("日記")).toMatchObject({ slug: "", problem: "Use letters, digits, '.', '-' or '_'" });
  });

  it("keeps the personal notebook's name, .git names and over-long names from being created", () => {
    expect(checkNotebookName("My Notes")).toMatchObject({ slug: "My-Notes", problem: "my-notes is your personal notebook" });
    expect(checkNotebookName("notes.git")).toMatchObject({ problem: "A name can't end in .git" });
    expect(checkNotebookName("x".repeat(101))).toMatchObject({ problem: "Keep it to 100 characters" });
    expect(checkNotebookName("x".repeat(100)).problem).toBeNull();
  });
});

describe("a username to invite", () => {
  it.each(["octo-bob", " @octo-bob ", "a", "x".repeat(39)])("accepts %j", (typed) => {
    expect(usernameToInvite(typed)).toBe(typed.trim().replace(/^@/, ""));
  });

  it.each(["", "-octo", "octo-", "octo--bob", "octo bob", "octo_bob", "x".repeat(40)])("refuses %j", (typed) => {
    expect(usernameToInvite(typed)).toBeNull();
  });
});
