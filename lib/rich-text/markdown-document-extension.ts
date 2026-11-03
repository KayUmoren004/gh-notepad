import { Extension } from "@tiptap/core";
import { MarkdownCodec } from "./markdown-codec";
import { MarkdownDocument } from "./markdown-document";

export interface MarkdownDocumentStorage {
  codec: MarkdownCodec;
  /** The Markdown the editor content was last loaded from or merged with. */
  document: MarkdownDocument;
}

declare module "@tiptap/core" {
  interface Storage {
    markdownDocument: MarkdownDocumentStorage;
  }
}

/** Loads the note body into the editor and keeps what serialising it back needs. */
export const MarkdownDocumentExtension = Extension.create<{ markdown: string }, MarkdownDocumentStorage>({
  name: "markdownDocument",

  addOptions() {
    return { markdown: "" };
  },

  addStorage() {
    return {} as MarkdownDocumentStorage;
  },

  onBeforeCreate() {
    this.storage.codec = new MarkdownCodec(this.editor.extensionManager.baseExtensions, this.editor.schema);
    this.storage.document = MarkdownDocument.load(this.storage.codec, this.options.markdown);
    this.editor.options.content = this.storage.document.doc.toJSON();
  },
});
