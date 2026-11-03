"use client";

import { type Editor, findParentNode } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { BetweenHorizontalEnd, BetweenVerticalEnd, Bold, Code, Italic, Link, Strikethrough, Trash2 } from "lucide-react";
import { type RefObject, useRef } from "react";
import { cn } from "@/lib/utils";
import type { InputModality } from "./input-modality";
import { LinkField } from "./link-field";
import { ToolbarButton } from "./toolbar-button";

/** A popover's surface: origin-aware, and it animates in only when a pointer opened it. */
export const popoverSurface = cn(
  "flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
  "data-[side=top]:origin-bottom data-[side=bottom]:origin-top",
  "data-[animate=true]:animate-in data-[animate=true]:fade-in-0 data-[animate=true]:duration-150 data-[animate=true]:ease-out",
  "motion-safe:data-[animate=true]:zoom-in-95 motion-safe:data-[animate=true]:data-[side=top]:slide-in-from-bottom-1 motion-safe:data-[animate=true]:data-[side=bottom]:slide-in-from-top-1",
);

const finePointer = () => window.matchMedia("(pointer: fine)").matches;

/** Which side of its anchor a popover ended up on, for its transform origin. */
function orient(surface: HTMLElement | null, anchorTop: number) {
  const menu = surface?.parentElement;
  if (!surface || !menu) return;
  surface.dataset.side = menu.getBoundingClientRect().top >= anchorTop ? "bottom" : "top";
}

interface BarProps {
  editor: Editor;
  modality: RefObject<InputModality>;
}

interface FormatBarProps extends BarProps {
  linking: boolean;
  setLinking: (linking: boolean) => void;
}

/** The format bar above a text selection (fine pointers; phones use the bar above the keyboard). */
export function FormatBar({ editor, modality, linking, setLinking }: FormatBarProps) {
  const surface = useRef<HTMLDivElement>(null);
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatBar"
      updateDelay={100}
      shouldShow={({ editor: e, view, state, element }) => {
        const focused = view.hasFocus() || element.contains(document.activeElement);
        if (!finePointer() || !focused || !e.isEditable) return false;
        const { selection } = state;
        if (selection instanceof NodeSelection || selection.$from.parent.type.spec.code) return false;
        const hasText = !selection.empty && state.doc.textBetween(selection.from, selection.to).trim().length > 0;
        return hasText || e.isActive("link");
      }}
      options={{
        placement: "top",
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        onShow: () => {
          if (!surface.current) return;
          surface.current.dataset.animate = String(modality.current === "pointer");
          // Mod+K can open the link field before the bar is on screen; focus it once it is.
          surface.current.querySelector("input")?.focus();
        },
        onHide: () => setLinking(false),
        onUpdate: () => orient(surface.current, editor.view.coordsAtPos(editor.state.selection.from).bottom),
      }}
      className="z-50"
    >
      <div ref={surface} role="toolbar" aria-label="Format" data-side="top" data-animate="false" className={popoverSurface}>
        {linking ? (
          <LinkField editor={editor} onDone={() => setLinking(false)} />
        ) : (
          <>
            <ToolbarButton icon={Bold} label="Bold" active={marks.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolbarButton icon={Italic} label="Italic" active={marks.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <ToolbarButton
              icon={Strikethrough}
              label="Strikethrough"
              active={marks.strike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <ToolbarButton icon={Code} label="Code" active={marks.code} onClick={() => editor.chain().focus().toggleCode().run()} />
            <ToolbarButton icon={Link} label="Link" active={marks.link} onClick={() => setLinking(true)} />
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

/** The table's DOM element around the selection, if the selection is in a table. */
function tableElement(editor: Editor): HTMLElement | null {
  const table = findParentNode((node) => node.type.name === "table")(editor.state.selection);
  const dom = table ? editor.view.nodeDOM(table.pos) : null;
  return dom instanceof HTMLElement ? dom : null;
}

/** The row and column actions shown above a table while the cursor is in it (fine pointers). */
export function TableBar({ editor, modality }: BarProps) {
  const surface = useRef<HTMLDivElement>(null);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBar"
      shouldShow={({ editor: e, view, state }) => finePointer() && view.hasFocus() && state.selection.empty && e.isActive("table")}
      getReferencedVirtualElement={() => {
        const table = tableElement(editor);
        return table && { getBoundingClientRect: () => table.getBoundingClientRect(), getClientRects: () => table.getClientRects() };
      }}
      options={{
        placement: "top-start",
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        onShow: () => {
          if (surface.current) surface.current.dataset.animate = String(modality.current === "pointer");
        },
        onUpdate: () => orient(surface.current, tableElement(editor)?.getBoundingClientRect().bottom ?? 0),
      }}
      className="z-40"
    >
      <div ref={surface} role="toolbar" aria-label="Table" data-side="top" data-animate="false" className={popoverSurface}>
        <TableActions editor={editor} />
      </div>
    </BubbleMenu>
  );
}

/** Row and column actions for the table around the cursor. */
export function TableActions({ editor, size }: { editor: Editor; size?: "default" | "touch" }) {
  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => command(editor.chain().focus()).run();
  return (
    <>
      <ToolbarButton icon={BetweenHorizontalEnd} label="Add row" size={size} onClick={run((c) => c.addRowAfter())} />
      <ToolbarButton icon={BetweenVerticalEnd} label="Add column" size={size} onClick={run((c) => c.addColumnAfter())} />
      <ToolbarButton label="Delete row" size={size} onClick={run((c) => c.deleteRow())} />
      <ToolbarButton label="Delete column" size={size} onClick={run((c) => c.deleteColumn())} />
      <ToolbarButton icon={Trash2} label="Delete table" size={size} onClick={run((c) => c.deleteTable())} />
    </>
  );
}
