"use client";

import { useCallback, useEffect, useState } from "react";
import { DESKTOP, NoteScreen, Sidebar, SidebarProvider, TopBar, useMediaQuery, useNoteRoute, useShortcuts, useSidebar, type ScreenPhase } from "@/components/shell";
import { modifierLabel } from "@/components/shell/media";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";
import { NotepadProvider, useNote, useNotepad, useSyncStatus } from "./notepad-provider";

export interface ShellMember {
  id: number;
  login: string;
  avatarUrl: string;
}

/**
 * The notes screen: the sidebar's notebook tree and the note the URL names.
 * Everything reads from the device store; sync runs in the background.
 */
export function NotesApp({ member }: { member: ShellMember }) {
  return (
    <NotepadProvider
      account={{ id: member.id, login: member.login }}
      fallback={<p className="m-auto text-sm text-muted-foreground">Opening your notes…</p>}
    >
      <SidebarProvider>
        <Shell member={member} />
      </SidebarProvider>
    </NotepadProvider>
  );
}

function Shell({ member }: { member: ShellMember }) {
  const { store, engine } = useNotepad();
  const route = useNoteRoute();
  const sidebar = useSidebar();
  const desktop = useMediaQuery(DESKTOP);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Whether the next push or pop of the note screen slides: taps do, keyboard actions never.
  const [animate, setAnimate] = useState(true);
  const [screenPhase, setScreenPhase] = useState<ScreenPhase>("closed");
  const noteOpen = route.noteId !== null;

  const show = useCallback(
    (id: string, { instant = false } = {}) => {
      setAnimate(!instant);
      if (id === route.noteId) return;
      // Switching notes is a good moment to sync what was just written.
      engine.requestSync();
      route.open(id);
    },
    [engine, route],
  );
  const create = useCallback(
    ({ instant = false } = {}) => {
      const id = store.createNote();
      setCreatedId(id);
      show(id, { instant });
    },
    [store, show],
  );
  const back = useCallback(() => {
    setAnimate(true);
    engine.requestSync();
    route.close();
  }, [engine, route]);

  const newNote = useCallback(() => create({ instant: true }), [create]);
  const toggleSidebar = useCallback(() => sidebar.toggle({ instant: true }), [sidebar]);
  useShortcuts({ newNote, toggleSidebar });

  // The note last opened stays on screen while a phone's note screen slides out.
  const [lastNoteId, setLastNoteId] = useState(route.noteId);
  if (route.noteId !== null && route.noteId !== lastNoteId) setLastNoteId(route.noteId);
  const closing = !noteOpen && !desktop && animate && screenPhase !== "closed";
  const viewedId = route.noteId ?? (closing ? lastNoteId : null);

  // Under a settled note screen the tree goes invisible: it keeps its scroll position, takes no taps.
  const treeCovered = !desktop && noteOpen && screenPhase === "open";

  return (
    <div className="flex h-full w-full">
      <div
        inert={desktop ? sidebar.collapsed : noteOpen}
        data-collapsed={sidebar.collapsed || undefined}
        data-instant={sidebar.instant || undefined}
        className={cn(
          "relative w-full shrink-0 overflow-hidden md:w-68",
          "md:transition-[width] md:duration-(--duration-base) md:ease-out motion-reduce:md:transition-none data-[instant]:md:transition-none",
          "data-[collapsed]:md:w-0",
          treeCovered && "max-md:invisible",
        )}
      >
        <Sidebar
          member={member}
          openId={route.noteId}
          onOpen={show}
          onCreate={() => create()}
          className={cn(
            "md:transition-[translate,opacity] md:duration-(--duration-base) md:ease-out motion-reduce:md:transition-[opacity] in-data-[instant]:md:transition-none",
            sidebar.collapsed && "md:-translate-x-full md:opacity-0",
          )}
        />
      </div>

      <NoteScreen open={noteOpen} animate={!desktop && animate} onBack={back} onPhaseChange={setScreenPhase}>
        {viewedId !== null ? (
          <NoteView id={viewedId} focusTitle={viewedId === createdId} onBack={back} />
        ) : (
          <NothingOpen />
        )}
      </NoteScreen>
    </div>
  );
}

/** The note the URL names, or what stands in for it while sync looks, or when it never arrives. */
function NoteView({ id, focusTitle, onBack }: { id: string; focusTitle: boolean; onBack: () => void }) {
  const note = useNote(id);
  const status = useSyncStatus();
  const title = note?.title;

  useEffect(() => {
    if (title === undefined) return;
    document.title = `${title} · Notepad`;
    return () => {
      document.title = "Notes · Notepad";
    };
  }, [title]);

  if (note) return <NoteEditor noteId={id} focusTitle={focusTitle} onBack={onBack} />;

  // Until the first sync has had its say, the note may still be on its way.
  const looking = status.state === "syncing" || (status.state === "idle" && status.lastSyncedAt === null);
  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={onBack} />
      <div className="flex flex-1 items-center justify-center px-6">
        <p aria-live="polite" className="max-w-xs text-center text-sm text-pretty text-muted-foreground">
          {looking ? "Opening…" : "This note isn't in your notebooks."}
        </p>
      </div>
    </div>
  );
}

/** Desktop, with nothing open: the sidebar is where to go. */
function NothingOpen() {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-xs text-center text-sm text-pretty text-muted-foreground">
          Pick a note from the sidebar, or press{" "}
          <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{modifierLabel()}N</kbd> to
          start a new one.
        </p>
      </div>
    </div>
  );
}
