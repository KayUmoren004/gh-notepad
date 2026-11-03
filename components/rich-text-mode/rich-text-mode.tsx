"use client";

import { Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
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
  /** The cursor: the text of every textblock and where in them it is; null until the editor exists. */
  selection: () => { blocks: string[]; block: number; offset: number } | null;
  /** Puts the cursor `offset` characters into the `block`th textblock, scrolled into view. */
  placeCursor: (block: number, offset: number, focus: boolean) => void;
}

/** Every textblock in `doc`, in order, with its position. */
function textblocks(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode }[] {
  const blocks: { pos: number; node: ProseMirrorNode }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ pos, node });
    return false;
  });
  return blocks;
}

/** A textblock's text up to `to`, with one character per inline atom (a soft break, an image). */
const textOf = (node: ProseMirrorNode, to = node.content.size) => node.textBetween(0, to, undefined, " ");

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

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (!editor) return;
        const { view } = editor;
        // Not `commands.focus("start")`: on a desktop it focuses the DOM only in the next animation frame,
        // so a key pressed meanwhile (Enter in the title, then the first letter of the body) still goes to
        // what had focus before. Set the cursor and take focus now, in the same task as the key that asked.
        view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)).scrollIntoView());
        view.focus();
      },
      selection: () => {
        if (!editor) return null;
        const blocks = textblocks(editor.state.doc);
        const head = editor.state.selection.$head.pos;
        let block = blocks.findIndex(({ pos, node }) => head >= pos + 1 && head <= pos + 1 + node.content.size);
        let offset = 0;
        if (block === -1) block = Math.max(0, blocks.findLastIndex(({ pos }) => pos < head));
        else offset = textOf(blocks[block].node, head - blocks[block].pos - 1).length;
        return { blocks: blocks.map(({ node }) => textOf(node)), block, offset };
      },
      placeCursor: (block, offset, focus) => {
        if (!editor) return;
        const blocks = textblocks(editor.state.doc);
        const target = blocks[Math.min(Math.max(block, 0), blocks.length - 1)];
        const pos = target ? target.pos + 1 + Math.min(Math.max(offset, 0), target.node.content.size) : 0;
        editor.chain().setTextSelection(pos).scrollIntoView().run();
        // Not `commands.focus(pos)`: on a phone it focuses the DOM before dispatching its own transaction, and
        // whatever the focus itself changes (Tiptap's focus mark, a re-read of the DOM) then makes that stale.
        if (focus) editor.view.focus();
      },
    }),
    [editor],
  );

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
