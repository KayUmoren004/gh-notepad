"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Ellipsis, FileText, Folder, FolderOpen, Notebook } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { NotebookRowMenu } from "@/components/notebooks";
import { useNotepad } from "@/components/notes/notepad-provider";
import { folderKey, formatNoteCount, type DragSource, type TreeRow } from "@/lib/notebook-tree";
import { cn } from "@/lib/utils";
import { NewFolderDialog, type FolderPlace } from "./folder-dialogs";
import { DESKTOP, useMediaQuery } from "./media";
import { MoveToSheet } from "./move-to-sheet";
import { sourceOf, useTreeDrag, type DragState, type TreeDrag } from "./tree-drag";
import { openRowMenuFrom, RowMenu, type RowAction } from "./tree-row-menu";

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
  /** Creates a note in a notebook, from the notebook row's menu; a keyboard activation has `event.detail === 0`. */
  onCreateIn?: (notebook: string, event: React.MouseEvent) => void;
}

/** Where a new folder goes, and the row to expand so it shows. */
interface Creating extends FolderPlace {
  expandKey: string | null;
}

/**
 * The notebook tree as a list, virtualised: a notebook with thousands of
 * notes renders only the rows in view, so scrolling stays smooth. Rows are
 * renamed in place, given folders and moved from their menu; on desktop,
 * notes and folders are also dragged into folders.
 */
export function NotebookTree({ rows, scroller, openId, onOpen, onToggle, onCreateIn }: NotebookTreeProps) {
  const { store } = useNotepad();
  const list = useRef<HTMLUListElement>(null);
  const desktop = useMediaQuery(DESKTOP);
  const rowHeight = desktop ? ROW_HEIGHT.desktop : ROW_HEIGHT.phone;
  const [offset, setOffset] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [moving, setMoving] = useState<DragSource | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);

  const expand = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    if (row && row.kind !== "note" && !row.expanded) onToggle(key);
  };
  const drag = useTreeDrag({
    rows,
    scroller,
    enabled: desktop,
    onExpand: expand,
    onDrop: (source, target) => {
      if (source.kind === "note") store.moveNote(source.id, target.folder);
      else store.moveFolder(source.notebook, source.path, target.folder);
      if (target.folder) expand(folderKey(target.notebook, target.folder));
    },
  });

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

  /** Puts the keyboard back on a row once an edit has replaced it. */
  function focusRow(key: string) {
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLElement>(`[data-tree-row="${CSS.escape(key)}"] button`)?.focus();
    });
  }

  function createIn(row: TreeRow) {
    if (row.kind === "notebook") setCreating({ notebook: row.notebook.id, parent: "", expandKey: row.expanded ? null : row.key });
    else if (row.kind === "folder") {
      setCreating({ notebook: row.folder.notebook, parent: row.folder.path, expandKey: row.expanded ? null : row.key });
    }
  }

  function act(row: TreeRow, action: RowAction) {
    if (action === "rename") setRenaming(row.key);
    else if (action === "move") setMoving(sourceOf(row));
    else createIn(row);
  }

  function commitRename(row: TreeRow, name: string) {
    setRenaming(null);
    if (row.kind === "note") {
      store.rename(row.note.id, name);
      focusRow(row.key);
    } else if (row.kind === "folder") {
      const path = store.renameFolder(row.folder.notebook, row.folder.path, name);
      focusRow(folderKey(row.folder.notebook, path));
    }
  }

  return (
    <>
      <RowMenu rows={rows} disabled={drag.drag !== null} onOpenChange={setMenuKey} onAction={act}>
        <ul ref={list} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <li
                key={item.key}
                className="absolute inset-x-0 top-0"
                style={{ height: item.size, transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
              >
                <Row
                  row={row}
                  current={row.kind === "note" && row.note.id === openId}
                  renaming={renaming === row.key}
                  menuOpen={menuKey === row.key}
                  drag={drag}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onCreateIn={onCreateIn}
                  onCreateFolder={() => createIn(row)}
                  onRename={() => setRenaming(row.key)}
                  onRenameCommit={(name) => commitRename(row, name)}
                  onRenameCancel={() => {
                    setRenaming(null);
                    focusRow(row.key);
                  }}
                />
              </li>
            );
          })}
        </ul>
      </RowMenu>
      {/* What a drop would do, for assistive technology; the ghost shows it to everyone else. */}
      <p aria-live="polite" className="sr-only">
        {drag.drag?.problem ?? ""}
      </p>
      {drag.drag && <DragGhost drag={drag.drag} rows={rows} />}
      <MoveToSheet
        source={moving}
        onClose={() => setMoving(null)}
        onMoved={(folder) => {
          if (moving && folder) expand(folderKey(moving.notebook, folder));
        }}
      />
      <NewFolderDialog
        place={creating}
        onClose={() => setCreating(null)}
        onCreated={() => {
          if (creating?.expandKey) onToggle(creating.expandKey);
        }}
      />
    </>
  );
}

/** The dragged item's name beside the pointer, and where it is going or why it can't. */
function DragGhost({ drag, rows }: { drag: DragState; rows: readonly TreeRow[] }) {
  const over = drag.overKey ? rows.find((row) => row.key === drag.overKey) : undefined;
  const destination = drag.target
    ? drag.target.folder
      ? drag.target.folder.slice(drag.target.folder.lastIndexOf("/") + 1)
      : over?.kind === "notebook"
        ? over.label
        : "the top level"
    : null;
  const line = drag.problem ?? (destination !== null ? `Move to ${destination}` : null);
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-50 max-w-64 rounded-md bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 select-none"
      style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }}
    >
      <div className="truncate">{drag.label}</div>
      {line && <div className={cn("truncate text-xs", drag.problem ? "text-destructive" : "text-muted-foreground")}>{line}</div>}
    </div>,
    document.body,
  );
}

function Row({
  row,
  current,
  renaming,
  menuOpen,
  drag,
  onOpen,
  onToggle,
  onCreateIn,
  onCreateFolder,
  onRename,
  onRenameCommit,
  onRenameCancel,
}: {
  row: TreeRow;
  current: boolean;
  renaming: boolean;
  menuOpen: boolean;
  drag: TreeDrag;
  onOpen: NotebookTreeProps["onOpen"];
  onToggle: NotebookTreeProps["onToggle"];
  onCreateIn: NotebookTreeProps["onCreateIn"];
  onCreateFolder: () => void;
  onRename: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
}) {
  const labelId = useId();
  const expandable = row.kind !== "note";
  const expanded = expandable ? row.expanded : undefined;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const Icon = row.kind === "notebook" ? Notebook : row.kind === "note" ? FileText : expanded ? FolderOpen : Folder;
  const count = row.kind === "notebook" ? row.notebook.noteCount : null;
  const title = count === null ? row.label : `${row.label}: ${formatNoteCount(count)}`;
  const paddingLeft = 8 + Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT_PX;
  const dragging = drag.drag;
  const dropState = dragging?.overKey === row.key ? (dragging.problem ? "invalid" : "valid") : undefined;
  const isSource =
    !!dragging &&
    (row.kind === "note"
      ? dragging.source.kind === "note" && dragging.source.id === row.note.id
      : row.kind === "folder" && dragging.source.kind === "folder" && dragging.source.path === row.folder.path);
  // A notebook row's "…" is the notebook menu (new note, collaborators, leaving), which sits beside the row.
  const notebookMenu = row.kind === "notebook" && onCreateIn ? row.notebook.id : null;

  const leading = (
    <>
      {expandable ? (
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      <Icon aria-hidden className="size-4 shrink-0" />
    </>
  );

  return (
    <div
      data-tree-row={row.key}
      data-renaming={renaming || undefined}
      data-drop={dropState}
      className="group group/notebook relative flex h-full items-center gap-0.5"
    >
      {renaming ? (
        <div
          style={{ paddingLeft }}
          className="flex h-full w-full min-w-0 items-center gap-1.5 rounded-md bg-sidebar-accent pr-2 text-base text-sidebar-foreground md:text-sm"
        >
          {leading}
          <RenameField
            label={row.kind === "note" ? "Note title" : "Folder name"}
            initial={row.label}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        </div>
      ) : (
        <button
          type="button"
          title={title}
          aria-expanded={expanded}
          aria-current={current ? "page" : undefined}
          onPointerDown={(event) => drag.onPointerDown(event, row)}
          onClick={(event) => {
            if (drag.consumeClick()) return;
            if (row.kind === "note") onOpen(row.note.id, event);
            else onToggle(row.key);
          }}
          onKeyDown={(event) => {
            if (event.key === "F2" && row.kind !== "notebook") {
              event.preventDefault();
              onRename();
            }
          }}
          style={{ paddingLeft }}
          className={cn(
            "pressable flex h-full w-full min-w-0 items-center gap-1.5 rounded-md text-left text-base outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm",
            // Room for the row's "…", which overlays the end of the row (always on a phone, on hover on desktop).
            notebookMenu ? "pr-2" : "pr-10 md:pr-2",
            row.kind === "notebook" ? "font-medium text-sidebar-foreground" : "text-muted-foreground",
            current && "bg-sidebar-accent text-sidebar-accent-foreground",
            isSource && "opacity-50",
            dropState === "valid" && "bg-sidebar-accent text-sidebar-foreground ring-1 ring-ring/60 ring-inset",
            dropState === "invalid" && "ring-1 ring-destructive/50 ring-inset",
          )}
        >
          {leading}
          <span id={labelId} className="min-w-0 flex-1 truncate">
            {row.label}
          </span>
          {count !== null && (
            <span aria-hidden className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
              {number.format(count)}
            </span>
          )}
        </button>
      )}
      {!renaming && notebookMenu && (
        <NotebookRowMenu
          notebookId={notebookMenu}
          name={row.label}
          onCreateNote={(event) => onCreateIn?.(notebookMenu, event)}
          onCreateFolder={onCreateFolder}
        />
      )}
      {!renaming && !notebookMenu && (
        // The row's "…": named "Actions" and described by the row, so a note called "Old" isn't matched twice.
        <button
          type="button"
          data-row-menu
          aria-label="Actions"
          aria-describedby={labelId}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Actions"
          onClick={(event: MouseEvent<HTMLButtonElement>) => openRowMenuFrom(event.currentTarget)}
          className={cn(
            "pressable absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            "md:inset-y-auto md:right-1 md:h-5 md:w-5 md:rounded-sm md:hover:bg-sidebar-accent md:hover:text-sidebar-foreground",
            // Desktop: only while the row is hovered or holds focus, or the menu is open; coarse pointers see it always.
            "md:hidden md:group-hover:flex md:group-focus-within:flex md:pointer-coarse:flex",
            menuOpen && "md:flex",
          )}
        >
          <Ellipsis aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The row's label as an input: Enter keeps the new name, Escape the old one, and so does leaving. */
function RenameField({
  label,
  initial,
  onCommit,
  onCancel,
}: {
  label: string;
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim() !== "" && value !== initial) onCommit(value);
    else onCancel();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }

  return (
    <input
      ref={input}
      aria-label={label}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      autoComplete="off"
      enterKeyHint="done"
      className="h-7 min-w-0 flex-1 rounded-sm bg-background px-1 text-base text-foreground ring-1 ring-ring/60 outline-none md:h-5 md:text-sm"
    />
  );
}
