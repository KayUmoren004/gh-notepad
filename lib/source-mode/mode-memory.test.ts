import { describe, expect, test } from "vitest";
import { initialMode, rememberedMode, rememberMode, type ModeStorage } from "./mode-memory";

function memory(): ModeStorage & { keys: () => string[] } {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    keys: () => [...items.keys()],
  };
}

const blocked: ModeStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("which mode a note opens in", () => {
  test("a plain note opens in rich text mode, a note with Markdown rich text mode can't show opens in source mode", () => {
    expect(initialMode(memory(), "octo", "n1", "# Plan\n\n- [ ] task\n")).toBe("rich-text");
    expect(initialMode(memory(), "octo", "n1", "Intro\n\n<div align=\"center\">raw HTML</div>\n")).toBe("source");
    expect(initialMode(memory(), "octo", "n1", "")).toBe("rich-text");
  });

  test("the mode chosen for a note is remembered for that note, member and device", () => {
    const storage = memory();
    rememberMode(storage, "octo", "n1", "source");

    expect(initialMode(storage, "octo", "n1", "plain\n")).toBe("source");
    expect(initialMode(storage, "octo", "n2", "plain\n")).toBe("rich-text");
    expect(initialMode(storage, "other", "n1", "plain\n")).toBe("rich-text");
    expect(rememberedMode(storage, "octo", "n1")).toBe("source");
    expect(rememberedMode(memory(), "octo", "n1")).toBeNull();
  });

  test("a remembered choice beats the note's content", () => {
    const storage = memory();
    rememberMode(storage, "octo", "n1", "rich-text");
    expect(initialMode(storage, "octo", "n1", "<div>raw HTML</div>\n")).toBe("rich-text");
  });

  test("storage that is missing, blocked or holding nonsense is treated as having no memory", () => {
    expect(initialMode(null, "octo", "n1", "plain\n")).toBe("rich-text");
    expect(initialMode(blocked, "octo", "n1", "plain\n")).toBe("rich-text");
    expect(() => rememberMode(blocked, "octo", "n1", "source")).not.toThrow();
    const storage = memory();
    storage.setItem(storage.keys()[0] ?? "notepad:octo:editing-mode:n1", "wysiwyg");
    expect(rememberedMode(storage, "octo", "n1")).toBeNull();
  });
});
