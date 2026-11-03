import { describe, expect, test } from "vitest";
import { joinLineEnding, splitLineEnding } from "./line-endings";

describe("line endings in source mode", () => {
  test("a file written with CRLF throughout is edited as LF and saved as CRLF again", () => {
    const { text, ending } = splitLineEnding("one\r\ntwo\r\n");
    expect(text).toBe("one\ntwo\n");
    expect(ending).toBe("\r\n");
    expect(joinLineEnding(`${text}three\n`, ending)).toBe("one\r\ntwo\r\nthree\r\n");
  });

  test("LF files, empty files and files with mixed endings are left alone", () => {
    for (const text of ["one\ntwo\n", "", "one\r\ntwo\n", "one\rtwo\r\n"]) {
      expect(splitLineEnding(text)).toEqual({ text, ending: "\n" });
      expect(joinLineEnding(text, "\n")).toBe(text);
    }
  });
});
