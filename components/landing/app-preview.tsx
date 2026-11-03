import {
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  Code,
  Ellipsis,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Heading,
  History,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  Notebook,
  Search,
  SquarePen,
  Strikethrough,
  TextQuote,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A hand-built, static picture of the app for the landing page: the notebook
 * sidebar beside a note in rich text mode on wide screens, the full-screen
 * phone editor on narrow ones. Assistive technology reads it as one image.
 */
export function AppPreview({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Preview of the notepad: a note called Garden plan, open in rich text mode with a task list, in the Projects folder of the my-notes notebook. It shows as synced."
      className={cn(
        "overflow-hidden rounded-2xl border bg-background text-left shadow-2xl shadow-black/40 select-none md:rounded-xl",
        className,
      )}
    >
      <div aria-hidden="true" className="flex h-120 md:h-140">
        <Sidebar className="hidden md:flex" />
        <div className="flex min-w-0 flex-1 flex-col">
          <DesktopTopBar className="hidden md:flex" />
          <PhoneTopBar className="md:hidden" />
          <NoteBody />
          <PhoneFormatBar className="md:hidden" />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Sidebar */

interface TreeRow {
  label: string;
  depth: 0 | 1 | 2;
  kind: "notebook" | "folder" | "note";
  open?: boolean;
  active?: boolean;
  shared?: boolean;
}

const tree: TreeRow[] = [
  { label: "my-notes", depth: 0, kind: "notebook", open: true },
  { label: "Journal", depth: 1, kind: "folder" },
  { label: "Projects", depth: 1, kind: "folder", open: true },
  { label: "Garden plan", depth: 2, kind: "note", active: true },
  { label: "Kitchen shelves", depth: 2, kind: "note" },
  { label: "Reading list", depth: 2, kind: "note" },
  { label: "Recipes", depth: 1, kind: "folder" },
  { label: "Groceries", depth: 1, kind: "note" },
  { label: "family-trip", depth: 0, kind: "notebook", shared: true },
];

const indent = { 0: "pl-2", 1: "pl-6", 2: "pl-10" } as const;

function Sidebar({ className }: { className?: string }) {
  return (
    <div className={cn("w-60 shrink-0 flex-col gap-5 border-r bg-sidebar p-2 text-sm text-sidebar-foreground", className)}>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-5 items-center justify-center rounded-full bg-accent text-xs font-medium">M</span>
          <span className="font-medium">mira</span>
        </div>
        <SidebarItem icon={Search}>
          Search
          <span className="ml-auto font-mono text-xs text-muted-foreground">⌘K</span>
        </SidebarItem>
        <SidebarItem icon={SquarePen}>New note</SidebarItem>
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Notebooks</SectionLabel>
        {tree.map((row) => (
          <TreeItem key={row.label} row={row} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Tags</SectionLabel>
        {["home", "ideas", "reading"].map((tag) => (
          <SidebarItem key={tag} icon={Hash}>
            {tag}
          </SidebarItem>
        ))}
      </div>

      <SidebarItem icon={Trash2} className="mt-auto">
        Trash
      </SidebarItem>
    </div>
  );
}

function TreeItem({ row }: { row: TreeRow }) {
  const Icon = row.kind === "notebook" ? Notebook : row.kind === "note" ? FileText : row.open ? FolderOpen : Folder;
  const Chevron = row.open ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md pr-2",
        indent[row.depth],
        row.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground",
      )}
    >
      {row.kind === "note" ? <span className="size-3.5 shrink-0" /> : <Chevron className="size-3.5 shrink-0" />}
      <Icon className="size-4 shrink-0" />
      <span className={cn("truncate", row.kind === "notebook" && "font-medium text-sidebar-foreground")}>{row.label}</span>
      {row.shared && <Users className="ml-auto size-3.5 shrink-0" />}
    </div>
  );
}

function SidebarItem({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground", className)}>
      <Icon className="size-4 shrink-0" />
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{children}</div>;
}

/* ---------------------------------------------------------------- Top bars */

function SyncedBadge() {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CloudCheck className="size-3.5" />
      Synced
    </span>
  );
}

function DesktopTopBar({ className }: { className?: string }) {
  return (
    <div className={cn("h-11 shrink-0 items-center justify-between gap-4 border-b px-4 text-sm", className)}>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span>my-notes</span>
        <ChevronRight className="size-3.5 shrink-0" />
        <span>Projects</span>
        <ChevronRight className="size-3.5 shrink-0" />
        <span className="truncate text-foreground">Garden plan</span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
        <SyncedBadge />
        <History className="size-4" />
        <span className="rounded-md border border-input px-2 py-0.5 text-xs text-foreground">Share</span>
        <Ellipsis className="size-4" />
      </div>
    </div>
  );
}

function PhoneTopBar({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-12 shrink-0 items-center justify-between border-b px-2 text-sm", className)}>
      <span className="flex items-center gap-0.5 text-muted-foreground">
        <ChevronLeft className="size-5" />
        Projects
      </span>
      <SyncedBadge />
      <Ellipsis className="mr-1 size-5 text-muted-foreground" />
    </div>
  );
}

/* ---------------------------------------------------------------- The note */

function NoteBody() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-5 pt-6 leading-7 md:px-10 md:pt-14">
        <div className="flex flex-col gap-3">
          <div className="text-2xl font-semibold tracking-tight md:text-4xl">Garden plan</div>
          <div className="flex gap-1.5">
            <Chip>home</Chip>
            <Chip>outside</Chip>
          </div>
        </div>

        {/* The selection sits early on the first line, so the format bar floats over the space beside the tags. */}
        <p>
          Raised beds go along the{" "}
          <span className="relative rounded-xs bg-ring/40 font-semibold">
            <FormatBar className="hidden md:flex" />
            south fence
          </span>
          , where they get six hours of sun. Cedar lasts longest without treatment.
        </p>
        <p>
          Order the soil before the{" "}
          <span className="underline decoration-muted-foreground underline-offset-4">spring sale</span> ends.
        </p>

        <div className="pt-2 text-lg font-semibold tracking-tight">This weekend</div>
        <ul className="flex flex-col gap-1.5">
          <Task done>Measure the fence line</Task>
          <Task done>Pick up cedar boards</Task>
          <Task>Build the first bed</Task>
          <Task caret>Plant garlic before the first frost</Task>
        </ul>

        <blockquote className="border-l-2 border-input pl-4 text-muted-foreground">Water deeply, not daily.</blockquote>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-muted px-1.5 text-xs leading-5 text-muted-foreground">{children}</span>;
}

function Task({ done = false, caret = false, children }: { done?: boolean; caret?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-1.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
          done ? "border-transparent bg-primary text-primary-foreground" : "border-ring",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className={cn(done && "text-muted-foreground line-through decoration-muted-foreground")}>
        {children}
        {/* Where the member is typing; a still caret, since nothing on this page loops. */}
        {caret && <span className="ml-px inline-block h-5 w-px translate-y-1 bg-foreground" />}
      </span>
    </li>
  );
}

/** The floating format bar rich text mode shows over a selection. */
function FormatBar({ className }: { className?: string }) {
  const tools: { icon: LucideIcon; active?: boolean }[] = [
    { icon: Bold, active: true },
    { icon: Italic },
    { icon: Strikethrough },
    { icon: Code },
    { icon: Link },
  ];
  return (
    <span
      className={cn(
        "absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 items-center gap-0.5 rounded-lg border border-input bg-popover p-1 font-normal text-popover-foreground shadow-lg shadow-black/30",
        className,
      )}
    >
      {tools.map(({ icon: Icon, active }, index) => (
        <span
          key={index}
          className={cn("flex size-7 items-center justify-center rounded-md", active ? "bg-accent" : "text-muted-foreground")}
        >
          <Icon className="size-4" />
        </span>
      ))}
    </span>
  );
}

/** The formatting bar that sits above the software keyboard on phones. */
function PhoneFormatBar({ className }: { className?: string }) {
  const tools = [Heading, Bold, Italic, List, ListChecks, TextQuote, Image, Link];
  return (
    <div className={cn("flex h-12 shrink-0 items-center justify-around border-t bg-card px-2 text-muted-foreground", className)}>
      {tools.map((Icon, index) => (
        <Icon key={index} className="size-5" />
      ))}
    </div>
  );
}
