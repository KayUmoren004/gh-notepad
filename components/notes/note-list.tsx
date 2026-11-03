"use client";

import type { Note } from "@/lib/device-store";
import { cn } from "@/lib/utils";

/** The first line of text in a body, without Markdown's block markers. */
function preview(body: string): string {
  for (const line of body.split("\n")) {
    const text = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, "").trim();
    if (text) return text;
  }
  return "";
}

/** Every note, flat: the layout ticket replaces this with the notebook's folder tree. */
export function NoteList({
  notes,
  openId,
  onOpen,
}: {
  notes: readonly Note[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  if (notes.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No notes yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-px px-2 pb-safe">
      {notes.map((note) => {
        const text = preview(note.body);
        return (
          <li key={note.id}>
            <button
              type="button"
              onClick={() => onOpen(note.id)}
              aria-current={note.id === openId ? "true" : undefined}
              className={cn(
                "pressable flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                note.id === openId && "bg-muted",
              )}
            >
              <span className="truncate text-sm font-medium text-foreground">{note.title}</span>
              <span className="truncate text-xs text-muted-foreground">{text || "No text"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
