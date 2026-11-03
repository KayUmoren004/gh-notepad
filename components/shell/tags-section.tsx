"use client";

import { Check, ChevronDown, ChevronRight, Hash } from "lucide-react";
import { useMemo } from "react";
import { useTagIndex } from "@/components/notes/notepad-provider";
import { formatNoteCount } from "@/lib/notebook-tree";
import { tagKey, type TagEntry } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { useDevicePreference } from "./device-preferences";

const number = new Intl.NumberFormat("en");

/** The tags the sidebar is filtered by: a note shows only when it carries every one of them. */
export interface TagFilter {
  /** The selected tags as shown. */
  names: string[];
  /** The same tags as matched, for `useNotebookTrees` and `useRecentNotes`. */
  keys: string[];
  /** Selects a tag, or unselects it if it is selected. */
  toggle: (name: string) => void;
  clear: () => void;
}

function parseNames(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/** The tag filter, remembered per device. */
export function useTagFilter(): TagFilter {
  const [stored, store] = useDevicePreference("tag-filter");
  const names = useMemo(() => parseNames(stored), [stored]);
  const keys = useMemo(() => names.map(tagKey), [names]);
  const save = (next: string[]) => store(next.length > 0 ? JSON.stringify(next) : null);
  return {
    names,
    keys,
    toggle: (name) => {
      const key = tagKey(name);
      const next = names.filter((candidate) => tagKey(candidate) !== key);
      if (next.length === names.length) next.push(name);
      save(next);
    },
    clear: () => save([]),
  };
}

/**
 * The sidebar's Tags section: every tag across notebooks with how many notes
 * carry it, most used first. Selecting tags filters the tree and Recent to the
 * notes carrying all of them. Folds away, remembered per device.
 */
export function TagsSection({ filter }: { filter: TagFilter }) {
  const index = useTagIndex();
  const [stored, store] = useDevicePreference("tags-open");
  const open = stored === "open";
  const Chevron = open ? ChevronDown : ChevronRight;

  // A selected tag that no note carries any more stays listed, at none, so it can be unselected.
  const rows = useMemo(() => {
    const list: TagEntry[] = [...index.tags];
    for (const name of filter.names) {
      const key = tagKey(name);
      if (!index.byKey.has(key)) list.push({ key, name, count: 0, noteIds: [] });
    }
    return list;
  }, [index, filter.names]);
  const selected = useMemo(() => new Set(filter.keys), [filter.keys]);

  return (
    <section aria-labelledby="sidebar-tags" className="flex flex-col gap-px">
      <button
        type="button"
        id="sidebar-tags"
        aria-expanded={open}
        aria-controls={open ? "sidebar-tag-list" : undefined}
        onClick={() => store(open ? null : "open")}
        className="pressable flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-base text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:h-7 md:text-sm"
      >
        <Hash aria-hidden className="size-4 shrink-0" />
        <span className="truncate">Tags</span>
        <span aria-hidden className="ml-auto shrink-0 text-xs text-muted-foreground/70 tabular-nums">
          {selected.size > 0 ? `${number.format(selected.size)} selected` : number.format(rows.length)}
        </span>
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      </button>
      {open &&
        (rows.length === 0 ? (
          <p id="sidebar-tag-list" className="px-2 pt-1 pb-2 text-sm text-pretty text-muted-foreground">
            No tags yet. Add one under a note&apos;s title.
          </p>
        ) : (
          <ul
            id="sidebar-tag-list"
            aria-label="Tags"
            className="flex max-h-[40dvh] flex-col gap-px overflow-y-auto overscroll-contain"
          >
            {rows.map((tag) => {
              const pressed = selected.has(tag.key);
              return (
                <li key={tag.key}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    title={`${tag.name}: ${formatNoteCount(tag.count)}`}
                    onClick={() => filter.toggle(tag.name)}
                    className={cn(
                      "pressable flex h-11 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 pl-4 text-left text-base text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:h-7 md:text-sm",
                      pressed && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    {pressed ? (
                      <Check aria-hidden className="size-3.5 shrink-0" />
                    ) : (
                      <span aria-hidden className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <span aria-hidden className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
                      {number.format(tag.count)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

/** Above the tree while a tag filter is on: what it is filtered by, and a way to clear it. */
export function TagFilterNotice({ filter, empty }: { filter: TagFilter; empty: boolean }) {
  if (filter.names.length === 0) return null;
  const names = filter.names.join(", ");
  return (
    <div className="mb-2 flex flex-col gap-1 rounded-md bg-sidebar-accent/50 px-2 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate" title={`Filtered by ${names}`}>
          Filtered by <span className="text-sidebar-foreground">{names}</span>
        </p>
        <button
          type="button"
          aria-label="Clear tag filter"
          onClick={filter.clear}
          className="pressable -my-1 -mr-1 h-7 shrink-0 rounded-sm px-1.5 text-xs font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear
        </button>
      </div>
      {empty && <p className="text-pretty">No notes have all of these tags.</p>}
    </div>
  );
}
