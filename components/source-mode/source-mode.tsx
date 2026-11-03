"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { joinLineEnding, minimalChanges, splitLineEnding, type CursorLocation, type LineEnding } from "@/lib/source-mode";
import { mergeIncoming } from "@/lib/source-mode/merge";
import { sourceTheme } from "@/lib/source-mode/theme";
import { cn } from "@/lib/utils";

export interface SourceModeProps {
  /**
   * The note body in Markdown. A value other than the last one this editor
   * produced is a change made elsewhere, and is merged into what is on screen.
   */
  value: string;
  /** The note body after each edit; loading a note never calls it. */
  onChange: (markdown: string) => void;
  /** The accessible name of the editing area. */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<SourceModeHandle>;
}

export interface SourceModeHandle {
  /** Puts the cursor at the start of the note body. */
  focus: () => void;
  /** The cursor: every line of the note and where in them it is. */
  selection: () => CursorLocation | null;
  /** Puts the cursor `offset` characters into line `block`, scrolled into view. */
  placeCursor: (block: number, offset: number, focus: boolean) => void;
}

/**
 * Source mode: a note body edited as the exact Markdown, in CodeMirror with
 * GitHub-Flavored Markdown highlighting. Value in, Markdown changes out: a
 * changed `value` is applied as the smallest edits that reach it, outside the
 * undo history, so the cursor and the member's own undo steps survive a sync.
 * Loaded on demand (see `index.ts`), and only ever rendered in the browser.
 */
export function SourceMode({
  value,
  onChange,
  label = "Note body",
  placeholder = "Write Markdown",
  autoFocus = false,
  className,
  ref,
}: SourceModeProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The Markdown this editor and its owner last agreed on, with the file's own line endings.
  const agreed = useRef(value);
  const ending = useRef<LineEnding>("\n");
  const handlers = useRef({ onChange });
  // The editor is created once, from the first props; later values are merged in.
  const initial = useRef({ value, label, placeholder, autoFocus });

  useEffect(() => {
    handlers.current = { onChange };
  });

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const loaded = splitLineEnding(initial.current.value);
    ending.current = loaded.ending;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: loaded.text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          placeholderText(initial.current.placeholder),
          EditorView.contentAttributes.of({
            "aria-label": initial.current.label,
            autocapitalize: "sentences",
            spellcheck: "true",
          }),
          sourceTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = joinLineEnding(update.state.doc.toString(), ending.current);
            if (text === agreed.current) return;
            agreed.current = text;
            handlers.current.onChange(text);
          }),
        ],
      }),
    });
    view.current = editor;
    if (initial.current.autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const editor = view.current;
        if (!editor) return;
        editor.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        editor.focus();
      },
      selection: () => {
        const editor = view.current;
        if (!editor) return null;
        const { doc, selection } = editor.state;
        const line = doc.lineAt(selection.main.head);
        const blocks: string[] = [];
        for (let number = 1; number <= doc.lines; number++) blocks.push(doc.line(number).text);
        return { blocks, block: line.number - 1, offset: selection.main.head - line.from };
      },
      placeCursor: (block, offset, focus) => {
        const editor = view.current;
        if (!editor) return;
        const { doc } = editor.state;
        const line = doc.line(Math.min(Math.max(block, 0), doc.lines - 1) + 1);
        editor.dispatch({ selection: { anchor: Math.min(line.from + Math.max(offset, 0), line.to) }, scrollIntoView: true });
        if (focus) editor.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const editor = view.current;
    if (!editor || value === agreed.current) return;
    const asLoaded = (text: string) => (ending.current === "\n" ? text : splitLineEnding(text).text);
    const current = editor.state.doc.toString();
    const base = asLoaded(agreed.current);
    // Set first: if the merge keeps unsaved typing, the update it causes reports the merged body.
    agreed.current = value;
    const changes = minimalChanges(current, mergeIncoming(current, base, asLoaded(value)));
    if (changes.length) editor.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
  }, [value]);

  return <div data-source-mode ref={host} className={cn("min-h-48", className)} />;
}
