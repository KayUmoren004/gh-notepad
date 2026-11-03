"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Notebook } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { NotebookRowMenu } from "@/components/notebooks";
import { formatNoteCount, type TreeRow } from "@/lib/notebook-tree";
import { cn } from "@/lib/utils";
import { DESKTOP, useMediaQuery } from "./media";

/** Rows are dense on desktop and finger-sized on a phone. */
const ROW_HEIGHT = { desktop: 28, phone: 44 };
/** Folders keep indenting this deep, then stop: a path 12 folders deep still leaves room for its names. */
const MAX_INDENT_DEPTH = 6;
const INDENT_PX = 14;

const number = new Intl.NumberFormat("en");

export interface NotebookTreeProps {
  rows: readonly TreeRow[];
  /** The scrolling ancestor; the list positions its rows inside it. */
  scroller: RefObject<HTMLElement | null>;
  openId: string | null;
  onOpen: (id: string, event: React.MouseEvent) => void;
  onToggle: (key: string) => void;
  /** Creates a note in a notebook and opens it, from the notebook row's menu. */
  onCreateIn?: (notebook: string, event: React.MouseEvent) => void;
}

/**
 * The notebook tree as a list, virtualised: a notebook with thousands of
 * notes renders only the rows in view, so scrolling stays smooth.
 */
export function NotebookTree({ rows, scroller, openId, onOpen, onToggle, onCreateIn }: NotebookTreeProps) {
  const list = useRef<HTMLUListElement>(null);
  const desktop = useMediaQuery(DESKTOP);
  const rowHeight = desktop ? ROW_HEIGHT.desktop : ROW_HEIGHT.phone;
  const [offset, setOffset] = useState(0);

  // The virtualiser hands out functions the React Compiler can't memoise, so it leaves this component alone.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index].key,
    scrollMargin: offset,
    overscan: 12,
  });

  // Whatever is above the list in the scroller (the Recent section, say) moves as the notes change.
  useLayoutEffect(() => {
    const top = list.current?.offsetTop ?? 0;
    if (top !== offset) setOffset(top);
  }, [rows, offset]);
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  // The open note scrolls into view when it is opened from elsewhere (a link, the Recent list).
  useEffect(() => {
    if (!openId) return;
    const index = rows.findIndex((row) => row.kind === "note" && row.note.id === openId);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: "auto" });
    // Only when the open note changes: a tree edit must not yank the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <ul ref={list} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        return (
          <li
            key={item.key}
            className="absolute inset-x-0 top-0"
            style={{ height: item.size, transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            {row.kind === "notebook" ? (
              // The notebook row and its "…" menu side by side: the menu can't live inside the row's button.
              <div className="group/notebook flex h-full items-center gap-0.5">
                <Row row={row} current={false} onOpen={onOpen} onToggle={onToggle} />
                {onCreateIn && (
                  <NotebookRowMenu
                    notebookId={row.notebook.id}
                    name={row.label}
                    onCreateNote={(event) => onCreateIn(row.notebook.id, event)}
                  />
                )}
              </div>
            ) : (
              <Row row={row} current={row.kind === "note" && row.note.id === openId} onOpen={onOpen} onToggle={onToggle} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Row({
  row,
  current,
  onOpen,
  onToggle,
}: {
  row: TreeRow;
  current: boolean;
  onOpen: NotebookTreeProps["onOpen"];
  onToggle: NotebookTreeProps["onToggle"];
}) {
  const expandable = row.kind !== "note";
  const expanded = expandable ? row.expanded : undefined;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const Icon = row.kind === "notebook" ? Notebook : row.kind === "note" ? FileText : expanded ? FolderOpen : Folder;
  const count = row.kind === "notebook" ? row.notebook.noteCount : null;
  const title = count === null ? row.label : `${row.label}: ${formatNoteCount(count)}`;

  return (
    <button
      type="button"
      title={title}
      aria-expanded={expanded}
      aria-current={current ? "page" : undefined}
      onClick={(event) => (row.kind === "note" ? onOpen(row.note.id, event) : onToggle(row.key))}
      style={{ paddingLeft: 8 + Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT_PX }}
      className={cn(
        "pressable flex h-full w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-base outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm",
        row.kind === "notebook" ? "font-medium text-sidebar-foreground" : "text-muted-foreground",
        current && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {expandable ? (
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {count !== null && (
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
          {number.format(count)}
        </span>
      )}
    </button>
  );
}
