"use client";

import { ChevronDown, ChevronLeft, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNotepad } from "@/components/notes/notepad-provider";
import { DESKTOP, TopBar, useMediaQuery } from "@/components/shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Note } from "@/lib/device-store";
import type { Session, Version } from "@/lib/history";
import { cn } from "@/lib/utils";
import { changesLabel, sessionLabel, timeLabel, whenLabel } from "./format";
import { LineDiff } from "./line-diff";
import { useHistory, type History } from "./use-history";
import { VersionPreview } from "./version-preview";

export interface HistoryPanelProps {
  note: Note;
  open: boolean;
  /** Opened or closed from the keyboard: no animation. */
  instant?: boolean;
  onClose: () => void;
  /** Where the preview loads images from, as the editor does. */
  imageSrc?: (src: string) => string;
}

/** How long the panel stays mounted while it slides out. */
const EXIT_MS = 300;

type Phase = "closed" | "entering" | "open" | "exiting";

/** Keeps the panel mounted through its exit, and gives its entrance a first frame to transition from. */
function usePresence(open: boolean, instant: boolean, element: React.RefObject<HTMLElement | null>) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const [wasOpen, setWasOpen] = useState(open);

  // `open` changed: the phase follows in this same render; an instant change skips the transition.
  if (open !== wasOpen) {
    setWasOpen(open);
    setPhase(open ? (instant ? "open" : "entering") : instant ? "closed" : "exiting");
  }

  // Entering: painted closed first, then let the transition bring it in.
  useLayoutEffect(() => {
    if (phase !== "entering") return;
    void element.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(frame);
  }, [phase, element]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const timer = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { mounted: phase !== "closed", shown: phase === "open" };
}

/**
 * A note's History: its versions grouped by editing session, each one
 * previewable, comparable with the note as it is now, and restorable. On a
 * desktop it is a side panel beside the editor; on a phone, a full-screen
 * sheet. It needs a connection; offline it says so, and shows whatever this
 * device has cached.
 */
export function HistoryPanel({ note, open, instant = false, onClose, imageSrc }: HistoryPanelProps) {
  const desktop = useMediaQuery(DESKTOP);
  const element = useRef<HTMLDivElement>(null);
  const { mounted, shown } = usePresence(open, instant, element);
  if (!mounted) return null;

  const content = <HistoryContent key={note.id} note={note} desktop={desktop} onClose={onClose} imageSrc={imageSrc} />;

  if (desktop) {
    return (
      <div
        ref={element}
        data-shown={shown || undefined}
        data-instant={instant || undefined}
        className={cn(
          "w-0 shrink-0 overflow-hidden",
          "transition-[width] duration-(--duration-base) ease-out motion-reduce:transition-none data-[instant]:transition-none",
          "data-[shown]:w-80",
        )}
      >
        <aside
          aria-label="History"
          className={cn(
            "flex h-full w-80 translate-x-full flex-col border-l bg-card opacity-0",
            "transition-[translate,opacity] duration-(--duration-base) ease-out motion-reduce:translate-x-0 motion-reduce:transition-[opacity] in-data-[instant]:transition-none",
            "in-data-[shown]:translate-x-0 in-data-[shown]:opacity-100",
          )}
        >
          {content}
        </aside>
      </div>
    );
  }

  return (
    <div
      ref={element}
      role="dialog"
      aria-modal="true"
      aria-label="History"
      data-shown={shown || undefined}
      data-instant={instant || undefined}
      className={cn(
        "fixed inset-0 z-40 flex translate-x-(--push-offset) flex-col bg-background opacity-0",
        "transition-[translate,opacity] duration-(--duration-enter) ease-out data-[instant]:transition-none",
        "data-[shown]:translate-x-0 data-[shown]:opacity-100",
      )}
    >
      {content}
    </div>
  );
}

type View = { kind: "list" } | { kind: "version"; version: Version };

function HistoryContent({
  note,
  desktop,
  onClose,
  imageSrc,
}: {
  note: Note;
  desktop: boolean;
  onClose: () => void;
  imageSrc?: (src: string) => string;
}) {
  const history = useHistory(note, true);
  const [view, setView] = useState<View>({ kind: "list" });
  const heading = useRef<HTMLHeadingElement>(null);

  // Focus lands on the heading, so the panel is announced and Escape works from the start.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    if (view.kind === "version") setView({ kind: "list" });
    else onClose();
  }

  const back = useCallback(() => setView({ kind: "list" }), []);

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      {desktop ? (
        <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3">
          <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-sm font-medium outline-none">
            History
          </h2>
          <Button variant="ghost" size="icon-sm" aria-label="Close history" title="Close history" className="text-muted-foreground" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </header>
      ) : (
        <TopBar onBack={onClose} backLabel="Note">
          <h2 ref={heading} tabIndex={-1} className="truncate text-sm font-medium outline-none">
            History
          </h2>
        </TopBar>
      )}
      {view.kind === "list" ? (
        <VersionList history={history} onSelect={(version) => setView({ kind: "version", version })} />
      ) : (
        <VersionView
          key={view.version.commit}
          note={note}
          version={view.version}
          history={history}
          onBack={back}
          imageSrc={imageSrc}
        />
      )}
    </div>
  );
}

/** A quiet notice standing in for the list, sized so the panel never jumps. */
function Notice({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <p className="text-sm font-medium text-pretty">{title}</p>
      {children && <p className="text-sm text-pretty text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

function VersionList({ history, onSelect }: { history: History; onSelect: (version: Version) => void }) {
  const { state } = history;
  const { store } = useNotepad();
  const { sessions } = state;

  if (state.kind === "loading" && sessions.length === 0) {
    return (
      <ul aria-busy="true" aria-label="Loading history" className="flex flex-col gap-px px-3 py-2">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="h-12 animate-pulse rounded-md bg-muted/60" style={{ animationDelay: `${index * 80}ms` }} />
        ))}
      </ul>
    );
  }
  if (state.kind === "offline" && sessions.length === 0) {
    return <Notice title="History needs a connection">Versions you have looked at on this device stay available offline.</Notice>;
  }
  if (state.kind === "failed" && sessions.length === 0) {
    return (
      <Notice
        title={state.message}
        action={
          <Button variant="outline" size="sm" className="mt-2" onClick={history.refresh}>
            Try again
          </Button>
        }
      />
    );
  }
  if (sessions.length === 0) {
    return <Notice title="No versions yet">A version is made each time the note syncs.</Notice>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.kind === "offline" && (
        <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-pretty text-muted-foreground">
          History needs a connection · showing the versions this device has
        </p>
      )}
      <ul aria-label="Versions" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 pb-safe">
        {sessions.map((session) => (
          <SessionRow key={session.versions[0].commit} session={session} login={store.account.login} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

const row =
  "pressable flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:py-2.5";

function SessionRow({ session, login, onSelect }: { session: Session; login: string; onSelect: (version: Version) => void }) {
  const [expanded, setExpanded] = useState(false);
  const latest = session.versions[0];
  const several = session.versions.length > 1;
  const by = (version: Version) => (version.author && version.author !== login ? ` · by ${version.author}` : "");

  return (
    <li className="px-2">
      <div className="flex items-stretch gap-0.5">
        <button type="button" className={row} onClick={() => onSelect(latest)}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm">{whenLabel(session.latest)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{changesLabel(session.versions.length)}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground" title={latest.message}>
            {latest.message || "No message"}
            {by(latest)}
          </span>
          <span className="sr-only">{sessionLabel(session)}</span>
        </button>
        {several && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide this session's changes" : "Show this session's changes"}
            className="pressable flex w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-(--duration-fast) ease-out", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {several && expanded && (
        <ul aria-label={`Changes ${whenLabel(session.latest)}`} className="mb-1 ml-3 border-l pl-1">
          {session.versions.map((version) => (
            <li key={version.commit}>
              <button type="button" className={cn(row, "py-1.5")} onClick={() => onSelect(version)}>
                <span className="truncate text-xs">
                  <span className="text-muted-foreground tabular-nums">{timeLabel(version.date)}</span>
                  {" · "}
                  {version.message || "No message"}
                  {by(version)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Loaded = { status: "loading" } | { status: "ready"; body: string } | { status: "missing" } | { status: "offline" } | { status: "failed" };

function VersionView({
  note,
  version,
  history,
  onBack,
  imageSrc,
}: {
  note: Note;
  version: Version;
  history: History;
  onBack: () => void;
  imageSrc?: (src: string) => string;
}) {
  const { store } = useNotepad();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [tab, setTab] = useState<"preview" | "changes">("preview");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    history.bodyAt(version).then(
      (body) => {
        if (!cancelled) setLoaded(body === null ? { status: "missing" } : { status: "ready", body });
      },
      (error: unknown) => {
        if (cancelled) return;
        const offline = error instanceof Error && "kind" in error && error.kind === "offline";
        setLoaded({ status: offline ? "offline" : "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [history, version]);

  const same = loaded.status === "ready" && loaded.body === note.body;

  function restore() {
    if (loaded.status !== "ready") return;
    store.editBody(note.id, loaded.body);
    setConfirming(false);
    onBack();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-1">
        <Button variant="ghost" size="sm" className="-ml-1 min-w-0 pl-1 text-muted-foreground" onClick={onBack}>
          <ChevronLeft aria-hidden className="size-5!" />
          <span className="truncate text-sm">Versions</span>
        </Button>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-1 pb-3">
        <p className="min-w-0">
          <span className="block truncate text-sm font-medium">{whenLabel(version.date)}</span>
          <span className="block truncate text-xs text-muted-foreground" title={version.message}>
            {version.message || "No message"}
          </span>
        </p>
        <div role="group" aria-label="Show" className="inline-flex h-8 w-fit items-center rounded-lg bg-muted p-0.5 pointer-coarse:h-10">
          {(["preview", "changes"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tab === option}
              onClick={() => setTab(option)}
              className="pressable h-full rounded-[min(var(--radius-md),12px)] px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
            >
              {option === "preview" ? "Preview" : "Changes"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
        {loaded.status === "loading" && (
          <div aria-busy="true" className="flex min-h-32 flex-col gap-2 px-4 py-3">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted/60" />
          </div>
        )}
        {loaded.status === "offline" && <Notice title="History needs a connection">This version hasn&apos;t been opened on this device yet.</Notice>}
        {loaded.status === "failed" && <Notice title="This version couldn&apos;t be loaded" />}
        {loaded.status === "missing" && <Notice title="This version has no text">The note didn&apos;t exist at this point.</Notice>}
        {loaded.status === "ready" &&
          (tab === "preview" ? (
            <div className="px-4 py-3">
              {loaded.body.trim() === "" ? (
                <p className="text-sm text-muted-foreground">Empty note</p>
              ) : (
                <VersionPreview markdown={loaded.body} imageSrc={imageSrc} />
              )}
            </div>
          ) : (
            <div className="py-2">
              <LineDiff before={loaded.body} after={note.body} />
            </div>
          ))}
      </div>

      <div className="shrink-0 border-t p-3 pb-safe">
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogTrigger
            render={<Button variant="outline" className="w-full" />}
            disabled={loaded.status !== "ready" || same}
            title={same ? "The note already has this text" : undefined}
          >
            Restore this version
          </AlertDialogTrigger>
          <AlertDialogContent className="duration-200 ease-out motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100">
            <AlertDialogHeader>
              <AlertDialogTitle>Restore this version?</AlertDialogTitle>
              <AlertDialogDescription>
                The note&apos;s text becomes the version from {whenLabel(version.date).toLowerCase()}. Nothing is lost:
                the restore syncs as a new version, and the note&apos;s history keeps every version before it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={restore}>Restore</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
