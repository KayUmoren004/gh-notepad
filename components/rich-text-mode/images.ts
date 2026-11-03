import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { RefObject } from "react";
import type { PickedImage } from "./slash-menu";

/** How the editor's owner handles images: files the member pastes or drops, and where to load images from. */
export interface ImageHandlers {
  /**
   * A file the member pasted or dropped into the note; resolves to the image
   * to insert, or null if it was refused (the owner tells the member why).
   */
  onImageFile?: (file: File) => Promise<PickedImage | null>;
  /**
   * The URL to load an image from, given the `src` written in the note. An
   * attachment's link (`/attachments/…`) is served through the app, or from
   * the device's own copy; anything else loads as written.
   */
  imageSrc?: (src: string) => string;
}

/** The owner's current image handlers, read when a paste, drop or draw happens rather than when the editor is made. */
export class ImageHandlerSource {
  constructor(private readonly handlers: RefObject<ImageHandlers>) {}

  get current(): ImageHandlers {
    return this.handlers.current;
  }
}

const imageFilesKey = new PluginKey("imageFiles");

/**
 * Images from files: pasting or dropping files inserts them as images at the
 * cursor (or where they were dropped), and every image is shown from the URL
 * `imageSrc` gives for its `src`. The note keeps the `src` as written, so an
 * attachment's root-relative link survives untouched.
 */
export const ImageFiles = Extension.create<{ handlers: ImageHandlerSource | null }>({
  name: "imageFiles",

  addOptions() {
    return { handlers: null };
  },

  addProseMirrorPlugins() {
    const { handlers } = this.options;
    if (!handlers) return [];
    const { editor } = this;

    const resolve = (src: string) => handlers.current.imageSrc?.(src) ?? src;

    /** Inserts the images for `files`, the first at `at` (or the cursor), the rest after it. */
    const insert = async (files: File[], at?: number) => {
      let position = at;
      for (const file of files) {
        const image = await handlers.current.onImageFile?.(file);
        if (!image) continue;
        const content = { type: "image", attrs: { src: image.src, alt: image.alt ?? "" } };
        const chain = editor.chain().focus();
        (position === undefined ? chain.insertContent(content) : chain.insertContentAt(position, content)).run();
        position = undefined;
      }
    };

    /** The files a paste or drop carries, if its owner takes them. */
    const filesOf = (transfer: DataTransfer | null): File[] | null => {
      const files = transfer ? [...transfer.files] : [];
      return files.length > 0 && handlers.current.onImageFile ? files : null;
    };

    return [
      new Plugin({
        key: imageFilesKey,
        props: {
          handlePaste: (_view, event) => {
            const files = filesOf(event.clipboardData);
            if (!files) return false;
            event.preventDefault();
            void insert(files);
            return true;
          },
          handleDrop: (view: EditorView, event, _slice, moved) => {
            if (moved) return false;
            const files = filesOf(event.dataTransfer);
            if (!files) return false;
            event.preventDefault();
            void insert(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
            return true;
          },
          nodeViews: {
            image: (node) => {
              const dom = document.createElement("img");
              const render = (current: ProseMirrorNode) => {
                const src = typeof current.attrs.src === "string" ? current.attrs.src : "";
                const shown = resolve(src);
                // Setting an unchanged `src` would load the image again.
                if (dom.getAttribute("src") !== shown) dom.setAttribute("src", shown);
                dom.alt = typeof current.attrs.alt === "string" ? current.attrs.alt : "";
                if (typeof current.attrs.title === "string" && current.attrs.title) dom.title = current.attrs.title;
                else dom.removeAttribute("title");
              };
              render(node);
              return {
                dom,
                update: (next) => {
                  if (next.type !== node.type) return false;
                  render(next);
                  return true;
                },
                ignoreMutation: () => true,
              };
            },
          },
        },
      }),
    ];
  },
});
