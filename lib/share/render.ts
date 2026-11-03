import { Marked, type Tokens } from "marked";
import { linkToAttachmentPath } from "@/lib/attachments";

export interface RenderOptions {
  /**
   * Where the published copy serves the attachment at this notebook path from
   * (relative to the share page), or `null` when the notebook doesn't hold it.
   */
  attachmentSrc: (path: string) => string | null;
}

export interface RenderedShare {
  html: string;
  /** The notebook paths of the attachments the HTML shows, each once. */
  attachments: string[];
}

/** Links a reader may follow from a public page; anything else becomes plain text. */
const SAFE_LINK = /^(?:https?:|mailto:)/i;
/** Images already on the web stay where they are; everything else must be an attachment. */
const WEB_IMAGE = /^https?:/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders a note's Markdown body for its share page: GitHub-flavoured
 * Markdown, with nothing a note could carry onto a public page.
 *
 * - Raw HTML in the note is shown as the text it is, never interpreted.
 * - Links keep only web and mail destinations; images come only from the
 *   notebook's attachments (rewritten to the published copies) or the web.
 *   A private app URL, an inline `data:` image or a script URL is dropped to
 *   its alt text.
 */
export function renderShareHtml(markdown: string, { attachmentSrc }: RenderOptions): RenderedShare {
  const attachments = new Set<string>();
  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        const escaped = escapeHtml(token.text);
        return "block" in token && token.block ? `<p>${escaped}</p>\n` : escaped;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        if (!SAFE_LINK.test(href)) return inner;
        const titled = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${titled} rel="noopener noreferrer">${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const path = linkToAttachmentPath(href);
        const src = path ? attachmentSrc(path) : WEB_IMAGE.test(href) ? href : null;
        if (!src) return escapeHtml(text);
        if (path) attachments.add(path);
        const titled = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${titled}>`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  return { html, attachments: [...attachments] };
}
