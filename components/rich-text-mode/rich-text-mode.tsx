"use client";

import { Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getMarkdown, mergeMarkdown, richTextExtensions } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { FormatBar, TableBar } from "./format-bar";
import { ImageFiles, ImageHandlerSource, type ImageHandlers, withImageViews } from "./images";
import { useInputModality } from "./input-modality";
import { MobileFormatBar } from "./mobile-format-bar";
import { type PickImage, SlashCommand, SlashMenu, SlashMenuStore } from "./slash-menu";

export type { ImageHandlers } from "./images";
export type { PickedImage, PickImage } from "./slash-menu";

export interface RichTextModeProps extends ImageHandlers {
  /**
   * The note body in Markdown. A value other than the last one this editor
   * produced is a change made elsewhere, and is merged into what is on screen.
   */
  value: string;
  /** The note body after each edit that changes its Markdown; loading a note never calls it. */
  onChange: (markdown: string) => void;
  /** The accessible name of the editing area. */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Offers "Image" in the slash menu; resolves to the image to insert, or null if the member cancelled. */
  onPickImage?: PickImage;
  className?: string;
  ref?: Ref<RichTextModeHandle>;
}

export interface RichTextModeHandle {
  /** Puts the cursor at the start of the note body. */
  focus: () => void;
}

/** Mod+K opens the link field for the selection. */
const LinkShortcut = Extension.create<{ open: () => void }>({
  name: "linkShortcut",
  addOptions() {
    return { open: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        const { selection } = this.editor.state;
        if (!selection.empty || this.editor.isActive("link")) this.options.open();
        return true;
      },
    };
  },
});

/**
 * Rich text mode: a note body edited as formatting, saved as GitHub-Flavored
 * Markdown. Value in, Markdown changes out: blocks the member doesn't touch
 * keep their bytes, and a changed `value` is merged in without moving the
 * cursor or losing what is being typed. Renders only on the client.
 */
export function RichTextMode({
  value,
  onChange,
  label = "Note body",
  placeholder = "Write, or type / for blocks",
  autoFocus = false,
  onPickImage,
  onImageFile,
  imageSrc,
  className,
  ref,
}: RichTextModeProps) {
  // The Markdown this editor and its owner last agreed on: the last value in or out.
  const agreed = useRef(value);
  const handlers = useRef({ onChange, onPickImage, onImageFile, imageSrc });
  const [slashMenu] = useState(() => new SlashMenuStore(handlers));
  const [imageHandlers] = useState(() => new ImageHandlerSource(handlers));
  const [linking, setLinking] = useState(false);
  const modality = useInputModality();

  useEffect(() => {
    handlers.current = { onChange, onPickImage, onImageFile, imageSrc };
  });

  // The editor is created once, from the first value; later values are merged in.
  const [extensions] = useState(() => [
    ...withImageViews(richTextExtensions({ markdown: value }), imageHandlers),
    Placeholder.configure({ placeholder }),
    SlashCommand.configure({ store: slashMenu }),
    ImageFiles.configure({ handlers: imageHandlers }),
    LinkShortcut.configure({ open: () => setLinking(true) }),
  ]);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? "end" : false,
    extensions,
    editorProps: {
      attributes: {
        class: "rich-text",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        autocapitalize: "sentences",
      },
      // Keep the cursor clear of the formatting bar above a phone's keyboard.
      scrollMargin: { top: 16, bottom: 80, left: 0, right: 0 },
      scrollThreshold: { top: 16, bottom: 80, left: 0, right: 0 },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = getMarkdown(current);
      if (markdown === agreed.current) return;
      agreed.current = markdown;
      handlers.current.onChange(markdown);
    },
  });

  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus("start") }), [editor]);

  useEffect(() => {
    if (!editor || value === agreed.current) return;
    const base = agreed.current;
    // Set first: if the merge keeps unsaved typing, the update it causes reports the merged body.
    agreed.current = value;
    mergeMarkdown(editor, value, base);
  }, [editor, value]);

  return (
    <div data-rich-text-mode className={cn("relative pointer-coarse:pb-16", className)}>
      {editor ? <EditorContent editor={editor} /> : <div aria-busy="true" aria-label={label} className="min-h-48" />}
      {editor && (
        <>
          <FormatBar editor={editor} modality={modality} linking={linking} setLinking={setLinking} />
          <TableBar editor={editor} modality={modality} />
          <SlashMenu store={slashMenu} />
          <MobileFormatBar editor={editor} slashMenu={slashMenu} linking={linking} setLinking={setLinking} />
        </>
      )}
    </div>
  );
}
