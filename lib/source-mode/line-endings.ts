export type LineEnding = "\n" | "\r\n";

/**
 * `text` with `\n` line endings, and the ending it used: CodeMirror reads
 * every line break as `\n`, so a file written with `\r\n` throughout gets
 * them back when it is saved. Mixed endings are left as they are.
 */
export function splitLineEnding(text: string): { text: string; ending: LineEnding } {
  const crlf = text.includes("\r\n") && !/\r(?!\n)|(?<!\r)\n/.test(text);
  return crlf ? { text: text.replace(/\r\n/g, "\n"), ending: "\r\n" } : { text, ending: "\n" };
}

export function joinLineEnding(text: string, ending: LineEnding): string {
  return ending === "\n" ? text : text.replace(/\n/g, "\r\n");
}
