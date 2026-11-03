"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Keyboard,
  Link,
  List,
  ListTodo,
  Plus,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TableActions } from "./format-bar";
import { isCoarsePointer } from "./input-modality";
import { LinkField } from "./link-field";
import type { SlashMenuStore } from "./slash-menu";
import { ToolbarButton } from "./toolbar-button";

/**
 * Keeps `bar` on top of the software keyboard. The keyboard shrinks the visual
 * viewport; on iOS the layout viewport (which `position: fixed` follows) keeps
 * its height, so the bar is lifted by the difference.
 */
function useAboveKeyboard(visible: boolean): RefObject<HTMLDivElement | null> {
  const bar = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!visible || !viewport) return;
    const place = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      if (bar.current) bar.current.style.transform = covered > 0 ? `translateY(${-covered}px)` : "";
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, [visible]);
  return bar;
}

interface MobileFormatBarProps {
  editor: Editor;
  slashMenu: SlashMenuStore;
  linking: boolean;
  setLinking: (linking: boolean) => void;
}

/** The formatting bar for touch screens, shown above the keyboard while the note has focus. */
export function MobileFormatBar({ editor, slashMenu, linking, setLinking }: MobileFormatBarProps) {
  const [visible, setVisible] = useState(false);
  const bar = useAboveKeyboard(visible);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      heading: e.isActive("heading"),
      bulletList: e.isActive("bulletList"),
      taskList: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
    }),
  });

  useEffect(() => {
    if (!isCoarsePointer()) return;
    const show = () => setVisible(true);
    // Focus moving into the bar (its link field) keeps it open.
    const hide = () =>
      requestAnimationFrame(() => setVisible(editor.isFocused || !!bar.current?.contains(document.activeElement)));
    editor.on("focus", show);
    editor.on("blur", hide);
    if (editor.isFocused) requestAnimationFrame(show);
    return () => {
      editor.off("focus", show);
      editor.off("blur", hide);
    };
  }, [editor, bar]);

  if (!visible) return null;

  const toggle = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => command(editor.chain().focus()).run();

  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-popover pb-safe px-safe will-change-transform"
    >
      <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain px-2 py-1 [scrollbar-width:none]">
        {linking ? (
          <LinkField editor={editor} size="touch" onDone={() => setLinking(false)} />
        ) : (
          <>
            {state.table ? (
              <TableActions editor={editor} size="touch" />
            ) : (
              <ToolbarButton icon={Plus} label="Insert block" size="touch" onClick={() => slashMenu.openFromPointer(editor)} />
            )}
            <ToolbarButton icon={Bold} label="Bold" size="touch" active={state.bold} onClick={toggle((c) => c.toggleBold())} />
            <ToolbarButton icon={Italic} label="Italic" size="touch" active={state.italic} onClick={toggle((c) => c.toggleItalic())} />
            <ToolbarButton
              icon={Strikethrough}
              label="Strikethrough"
              size="touch"
              active={state.strike}
              onClick={toggle((c) => c.toggleStrike())}
            />
            <ToolbarButton icon={Code} label="Code" size="touch" active={state.code} onClick={toggle((c) => c.toggleCode())} />
            <ToolbarButton icon={Link} label="Link" size="touch" active={state.link} onClick={() => setLinking(true)} />
            {!state.table && (
              <>
                <ToolbarButton
                  icon={Heading2}
                  label="Heading"
                  size="touch"
                  active={state.heading}
                  onClick={toggle((c) => c.toggleHeading({ level: 2 }))}
                />
                <ToolbarButton
                  icon={List}
                  label="Bulleted list"
                  size="touch"
                  active={state.bulletList}
                  onClick={toggle((c) => c.toggleBulletList())}
                />
                <ToolbarButton
                  icon={ListTodo}
                  label="Task list"
                  size="touch"
                  active={state.taskList}
                  onClick={toggle((c) => c.toggleTaskList())}
                />
                <ToolbarButton icon={Quote} label="Quote" size="touch" active={state.quote} onClick={toggle((c) => c.toggleBlockquote())} />
                <ToolbarButton
                  icon={SquareCode}
                  label="Code block"
                  size="touch"
                  active={state.codeBlock}
                  onClick={toggle((c) => c.toggleCodeBlock())}
                />
              </>
            )}
            <ToolbarButton icon={Keyboard} label="Hide keyboard" size="touch" className="ml-auto" onClick={() => editor.commands.blur()} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
