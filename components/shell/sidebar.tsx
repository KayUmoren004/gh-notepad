"use client";

import { FileText, Hash, PanelLeftClose, Search, SquarePen, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AccountMenu, type AccountMember } from "@/components/account/account-menu";
import { MigrationNotice } from "@/components/notes/migration-notice";
import { useNote, useNotebookTrees, useRecentNotes } from "@/components/notes/notepad-provider";
import { Button } from "@/components/ui/button";
import { flattenTrees, keysAbove } from "@/lib/notebook-tree";
import { cn } from "@/lib/utils";
import { useDevicePreference } from "./device-preferences";
import { modifierLabel } from "./media";
import { pathOfNote } from "./note-route";
import { NotebookTree } from "./notebook-tree";
import { useSidebar } from "./sidebar-state";

const RECENT = 5;

export interface SidebarProps {
  member: AccountMember;
  openId: string | null;
  /** Opens a note. A keyboard activation (`event.detail === 0`) is `instant`: no push animation. */
  onOpen: (id: string, options: { instant: boolean }) => void;
  onCreate: () => void;
  className?: string;
}

function parseKeys(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The notebook sidebar: who is signed in, New note, the last edited notes,
 * and the notebook tree. On a phone it is the home screen; on desktop it
 * sits beside the editor and can be collapsed.
 */
export function Sidebar({ member, openId, onOpen, onCreate, className }: SidebarProps) {
  const sidebar = useSidebar();
  const trees = useNotebookTrees();
  const recent = useRecentNotes(RECENT);
  const open = useNote(openId ?? "");
  const scroller = useRef<HTMLElement>(null);

  const [storedCollapsed, storeCollapsed] = useDevicePreference("collapsed-folders");
  const collapsed = useMemo(() => new Set(parseKeys(storedCollapsed)), [storedCollapsed]);
  const rows = useMemo(() => flattenTrees(trees, (key) => !collapsed.has(key)), [trees, collapsed]);
  const empty = trees.every((tree) => tree.noteCount === 0);

  const saveCollapsed = (next: Set<string>) => storeCollapsed(next.size > 0 ? JSON.stringify([...next]) : null);
  const toggleFolder = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveCollapsed(next);
  };

  // Opening a note shows it: the notebook and folders above it expand, once per note opened.
  const expandedFor = useRef<string | null>(null);
  const place = open ? `${open.id}\u0000${open.notebook}\u0000${open.folder}` : null;
  useEffect(() => {
    if (!open || expandedFor.current === place) return;
    expandedFor.current = place;
    const above = keysAbove(open.notebook, open.folder);
    if (!above.some((key) => collapsed.has(key))) return;
    const next = new Set(collapsed);
    for (const key of above) next.delete(key);
    saveCollapsed(next);
  });

  const hint = modifierLabel();

  return (
    <aside
      aria-label="Sidebar"
      className={cn("flex h-full w-full flex-col bg-sidebar text-sidebar-foreground md:w-68 md:border-r md:border-sidebar-border", className)}
    >
      <div className="shrink-0 px-2 pt-2 pt-safe">
        <div className="flex h-9 items-center gap-1 pl-2">
          <AccountMenu member={member} className="min-w-0 flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide sidebar"
            title={`Hide sidebar (${hint}\\)`}
            className="hidden text-muted-foreground md:inline-flex"
            onClick={() => sidebar.toggle()}
          >
            <PanelLeftClose aria-hidden />
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-px">
          <SidebarAction icon={SquarePen} hint={`${hint}N`} onClick={onCreate}>
            New note
          </SidebarAction>
          {/* TODO(#10): search opens the command palette; until that ticket lands the slot is disabled. */}
          <SidebarAction icon={Search} hint={`${hint}K`} disabled>
            Search
          </SidebarAction>
        </div>
      </div>

      <MigrationNotice className="mx-2 mt-2" />

      <nav
        ref={scroller}
        aria-label="Notes"
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-4 pb-6"
      >
        {recent.length > 0 && (
          <section aria-labelledby="sidebar-recent" className="mb-4">
            <SectionLabel id="sidebar-recent">Recent</SectionLabel>
            <ul className="flex flex-col gap-px">
              {recent.map((note) => (
                <li key={note.id}>
                  {/* A link to the note: a plain click opens it in place, a middle click in a new tab. */}
                  <a
                    href={pathOfNote(note.id)}
                    title={note.folder ? `${note.title} · ${note.folder}` : note.title}
                    aria-current={note.id === openId ? "page" : undefined}
                    onClick={(event) => {
                      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
                      event.preventDefault();
                      onOpen(note.id, { instant: event.detail === 0 });
                    }}
                    className={cn(
                      "pressable flex h-11 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-base text-muted-foreground outline-none select-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:h-7 md:text-sm",
                      note.id === openId && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <FileText aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{note.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="sidebar-notebooks">
          <SectionLabel id="sidebar-notebooks">Notebooks</SectionLabel>
          <NotebookTree
            rows={rows}
            scroller={scroller}
            openId={openId}
            onOpen={(id, event) => onOpen(id, { instant: event.detail === 0 })}
            onToggle={toggleFolder}
          />
          {empty && <p className="px-2 pt-1 text-sm text-muted-foreground">No notes yet. Start one with New note.</p>}
        </section>
      </nav>

      <div className="flex shrink-0 flex-col gap-px border-t border-sidebar-border px-2 py-2 pb-safe">
        {/* TODO(#9): tags, and TODO(#12): Trash, fill these; until then they are disabled placeholders. */}
        <SidebarAction icon={Hash} disabled>
          Tags
        </SidebarAction>
        <SidebarAction icon={Trash2} disabled>
          Trash
        </SidebarAction>
      </div>
    </aside>
  );
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-2 pb-1 text-xs font-medium text-muted-foreground select-none">
      {children}
    </h2>
  );
}

function SidebarAction({
  icon: Icon,
  hint,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pressable flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-base text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 md:h-7 md:text-sm"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
      {hint && (
        <span aria-hidden className="ml-auto hidden font-mono text-xs text-muted-foreground/70 md:inline">
          {hint}
        </span>
      )}
    </button>
  );
}
