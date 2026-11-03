"use client";

import { Dialog } from "@base-ui/react/dialog";
import { FileText, Search, SquarePen, X, type LucideIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import { recentNotes } from "@/lib/notebook-tree";
import { createNoteIndex, notePath, shortPath, type NoteIndex, type SearchResult, type Segment } from "@/lib/search";
import { cn } from "@/lib/utils";
import { getPaletteActions, subscribePaletteActions, type PaletteAction } from "./actions";
import { matchesAction } from "./palette-items";

/** How many of the last edited notes an empty query lists. */
const RECENT = 8;
/** How many results a query lists at most: enough to scroll, few enough to render in a frame. */
const LIMIT = 50;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a note, once the palette has closed. Keyboard-initiated, so open it without animation. */
  onOpenNote: (id: string) => void;
  onNewNote: () => void;
}

type Item =
  | { kind: "note"; key: string; title: string; segments: Segment[]; snippet: Segment[] | null; path: string[]; run: () => void }
  | { kind: "action"; key: string; label: string; icon?: LucideIcon; run: () => void };

interface Group {
  label: string;
  items: Item[];
}

/**
 * The command palette: a modal search over every note on the device, and the
 * actions that apply now. It opens and closes without animation, as it's used
 * all day, and its results change under the keystroke that caused them.
 */
export function CommandPalette({ open, onOpenChange, onOpenNote, onNewNote }: CommandPaletteProps) {
  const { store } = useNotepad();
  // One index for the life of the shell: the provider remounts everything when the store changes.
  const [index] = useState(createNoteIndex);
  const input = useRef<HTMLInputElement>(null);

  // Indexed once the shell is up, so the first search doesn't wait for a thousand notes.
  useEffect(() => {
    const timer = setTimeout(() => index.update(store.getState().notes), 0);
    return () => clearTimeout(timer);
  }, [index, store]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/60" />
        <Dialog.Popup
          aria-label="Search"
          initialFocus={input}
          className={cn(
            // A phone: the whole screen, the input at the top where the keyboard can't cover it.
            "fixed top-0 left-0 z-50 flex h-dvh w-full flex-col bg-popover text-popover-foreground outline-none pt-safe pb-safe px-safe",
            // A desktop: a centred box in the upper part of the screen. No open or close animation.
            "md:top-[12vh] md:left-1/2 md:h-auto md:max-h-[min(32rem,76vh)] md:w-[36rem] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:rounded-xl md:p-0 md:shadow-2xl md:ring-1 md:ring-foreground/10",
          )}
        >
          <Palette index={index} input={input} onOpenChange={onOpenChange} onOpenNote={onOpenNote} onNewNote={onNewNote} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The palette's inside, mounted only while it's open: its query starts empty each time. */
function Palette({
  index,
  input,
  onOpenChange,
  onOpenNote,
  onNewNote,
}: Omit<CommandPaletteProps, "open"> & { index: NoteIndex; input: React.RefObject<HTMLInputElement | null> }) {
  const { store } = useNotepad();
  const { notes } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const registered = useSyncExternalStore(subscribePaletteActions, getPaletteActions, getPaletteActions);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const trimmed = query.trim();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const groups = useMemo<Group[]>(() => {
    // Brings the index in step with the store before searching; unchanged notes are skipped by identity.
    index.update(notes);
    const openNote = (id: string) => () => {
      close();
      onOpenNote(id);
    };
    const noteItem = (result: SearchResult): Item => ({
      kind: "note",
      key: `note:${result.id}`,
      title: result.title,
      segments: result.titleSegments,
      snippet: result.snippet,
      path: result.path,
      run: openNote(result.id),
    });
    const groups: Group[] = [];
    if (trimmed) {
      const results = index.search(trimmed, { limit: LIMIT });
      const titles = results.filter((result) => result.kind === "title").map(noteItem);
      const texts = results.filter((result) => result.kind === "text").map(noteItem);
      if (titles.length > 0) groups.push({ label: "Notes", items: titles });
      if (texts.length > 0) groups.push({ label: "In the text", items: texts });
    } else {
      const recent = recentNotes(notes.values(), RECENT).map(
        (note): Item => ({
          kind: "note",
          key: `note:${note.id}`,
          title: note.title,
          segments: [{ text: note.title, marked: false }],
          snippet: null,
          path: notePath(note),
          run: openNote(note.id),
        }),
      );
      if (recent.length > 0) groups.push({ label: "Recent", items: recent });
    }
    const actions: PaletteAction[] = [{ id: "new-note", label: "New note", keywords: "create", icon: SquarePen, run: onNewNote }, ...registered];
    const matching = actions.filter((action) => matchesAction(action, trimmed));
    if (matching.length > 0) {
      groups.push({
        label: "Actions",
        items: matching.map((action) => ({
          kind: "action",
          key: `action:${action.id}`,
          label: action.label,
          icon: action.icon,
          run: () => {
            close();
            action.run();
          },
        })),
      });
    }
    return groups;
  }, [index, notes, registered, trimmed, close, onOpenNote, onNewNote]);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  const activeItem = activeIndex === -1 ? null : items[activeIndex];
  const activeId = activeItem ? `${listId}-${activeItem.key}` : undefined;

  // The active row stays in view as the arrow keys move it: at once, with no smooth scrolling.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activeItem?.run();
    }
  };

  const noNotes = trimmed.length > 0 && !groups.some((group) => group.label !== "Actions");

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search notes"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          placeholder="Search notes…"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Button variant="ghost" size="icon-sm" aria-label="Close search" className="-mr-1 text-muted-foreground md:hidden" onClick={close}>
          <X aria-hidden />
        </Button>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Results"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-2 p-2 [&_mark]:rounded-xs [&_mark]:bg-ring/35 [&_mark]:text-inherit"
      >
        {noNotes && (
          <p className="px-2 py-6 text-center text-sm text-pretty text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
            No notes match “{trimmed}”.
          </p>
        )}
        {groups.map((group) => {
          const labelId = `${listId}-${group.label}`;
          return (
            <div key={group.label} role="group" aria-labelledby={labelId} className="mb-2 last:mb-0">
              <div id={labelId} role="presentation" className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground select-none">
                {group.label}
              </div>
              {group.items.map((item) => {
                const id = `${listId}-${item.key}`;
                const isActive = item === activeItem;
                return (
                  <Option key={item.key} id={id} active={isActive} onHover={() => setActive(items.indexOf(item))} onRun={item.run} item={item} />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="hidden h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground select-none md:flex">
        <Hint keys="↑↓">move</Hint>
        <Hint keys="↵">open</Hint>
        <Hint keys="esc">close</Hint>
      </div>
    </>
  );
}

function Option({
  id,
  active,
  item,
  onHover,
  onRun,
}: {
  id: string;
  active: boolean;
  item: Item;
  onHover: () => void;
  onRun: () => void;
}) {
  const Icon = item.kind === "note" ? FileText : (item.icon ?? SquarePen);
  const title = item.kind === "note" ? (item.path.length > 1 ? `${item.title} · ${item.path.join(" / ")}` : item.title) : undefined;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      title={title}
      onPointerMove={onHover}
      onClick={onRun}
      className={cn(
        "flex min-h-11 cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 select-none md:min-h-9",
        // Press feedback only; the highlight moves between rows at once, as the arrow keys do.
        "transition-[scale] duration-(--duration-press) ease-out active:scale-(--press-scale)",
        "data-active:bg-accent data-active:text-accent-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {item.kind === "note" ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-base md:text-sm">{marked(item.segments)}</span>
            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground/80">{shortPath(item.path).join(" / ")}</span>
          </div>
          {item.snippet && <div className="truncate text-sm text-muted-foreground">{marked(item.snippet)}</div>}
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-base md:text-sm">{item.label}</span>
      )}
    </div>
  );
}

function marked(segments: Segment[]): ReactNode {
  return segments.map((segment, index) =>
    segment.marked ? <mark key={index}>{segment.text}</mark> : <Fragment key={index}>{segment.text}</Fragment>,
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded-sm bg-muted px-1 font-mono text-[11px] text-foreground/80">{keys}</kbd>
      {children}
    </span>
  );
}
