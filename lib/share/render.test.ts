import { describe, expect, it } from "vitest";
import { renderShareHtml } from ".";

/** A notebook holding one attachment. */
const inNotebook = (path: string) => (path === "attachments/beach.png" ? `attachments/beach.png` : null);

describe("rendering a shared note", () => {
  it("renders GitHub-flavoured Markdown: headings, lists, task lists, tables, code and emphasis", () => {
    const { html } = renderShareHtml(
      ["# Trip", "", "- [x] Pack", "- [ ] Go", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "```js", "let x = 1;", "```", "", "**bold** ~~gone~~ `code`", ""].join("\n"),
      { attachmentSrc: inNotebook },
    );
    expect(html).toContain("<h1>Trip</h1>");
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain("<table>");
    expect(html).toContain('<pre><code class="language-js">let x = 1;');
    expect(html).toContain("<strong>bold</strong> <del>gone</del> <code>code</code>");
  });

  it("never passes raw HTML through: tags written in the note show as text", () => {
    const { html } = renderShareHtml('<script>alert(1)</script>\n\nSee <b onmouseover="x">this</b>.\n', {
      attachmentSrc: inNotebook,
    });
    expect(html).not.toMatch(/<script|<b\b/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("See &lt;b onmouseover=&quot;x&quot;&gt;this&lt;/b&gt;.");
  });

  it("keeps links to the web and mail, and drops any other link to its text", () => {
    const { html } = renderShareHtml(
      '[site](https://example.com/a?b=1&c=2 "Title") [mail](mailto:a@example.com) [bad](javascript:alert(1)) [local](/notes/abc) [data](data:text/html,hi)\n',
      { attachmentSrc: inNotebook },
    );
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" title="Title" rel="noopener noreferrer">site</a>');
    expect(html).toContain('<a href="mailto:a@example.com" rel="noopener noreferrer">mail</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("/notes/abc");
    expect(html).not.toContain("data:");
    expect(html).toContain("bad");
    expect(html).toContain("local");
  });

  it("points attachments at the published copies and reports which it used", () => {
    const { html, attachments } = renderShareHtml("![Beach](/attachments/beach.png)\n\n![Twice](/attachments/beach.png)\n", {
      attachmentSrc: inNotebook,
    });
    expect(html).toContain('<img src="attachments/beach.png" alt="Beach">');
    expect(html).toContain('<img src="attachments/beach.png" alt="Twice">');
    expect(attachments).toEqual(["attachments/beach.png"]);
  });

  it("shows only the text of an image the notebook doesn't hold, a private app URL, or an unsafe source", () => {
    const { html, attachments } = renderShareHtml(
      [
        "![Missing](/attachments/missing.png)",
        "![Private](/api/notebooks/octo/my-notes/attachments/beach.png?branch=main)",
        '![Evil](javascript:alert(1) "t")',
        "![Inline](data:image/png;base64,AAAA)",
        "",
      ].join("\n"),
      { attachmentSrc: inNotebook },
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).toContain("Missing");
    expect(html).toContain("Private");
    expect(attachments).toEqual([]);
  });

  it("keeps images from the web, escaping their alt text and source", () => {
    const { html } = renderShareHtml('![A "quoted" cat](https://example.com/cat.png?a=1&b=2)\n', { attachmentSrc: inNotebook });
    expect(html).toContain('<img src="https://example.com/cat.png?a=1&amp;b=2" alt="A &quot;quoted&quot; cat">');
  });

  it("escapes what it quotes from the note: text, code and attribute values", () => {
    const { html } = renderShareHtml('a < b & c\n\n`<i>x</i>`\n\n![<img src=x onerror=alert(1)>](/attachments/beach.png)\n', {
      attachmentSrc: inNotebook,
    });
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).toContain("<code>&lt;i&gt;x&lt;/i&gt;</code>");
    expect(html).toContain('alt="&lt;img src=x onerror=alert(1)&gt;"');
    expect(html).not.toMatch(/<img src=x/);
  });
});
