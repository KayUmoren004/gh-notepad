"use client";

import { X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotepad } from "./notepad-provider";

/**
 * Tells the member which files from the previous version (v1) couldn't be
 * converted to notes, after the sync that converted the rest, until they
 * dismiss it. The files stay in the notebook's history on GitHub.
 */
export function MigrationNotice({ className }: { className?: string }) {
  const { engine } = useNotepad();
  const report = useSyncExternalStore(engine.subscribe, engine.getMigrationReport, engine.getMigrationReport);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!report || report.skipped.length === 0 || dismissed === report.commit) return null;

  const count = report.skipped.length;
  return (
    <section
      role="alert"
      aria-labelledby="migration-notice-title"
      className={cn("animate-enter rounded-lg border bg-card p-3 text-sm", className)}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="migration-notice-title" className="font-medium text-foreground">
            {count === 1 ? "1 old note couldn't be converted" : `${count} old notes couldn't be converted`}
          </h2>
          <p className="text-muted-foreground">
            Everything else from the previous version is now in your notes. These files couldn&apos;t be read, so
            they were left out; your notebook&apos;s history on GitHub keeps them.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setDismissed(report.commit)}>
          <X aria-hidden />
        </Button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {report.skipped.map(({ path, reason }) => (
          <li key={path} className="flex min-w-0 gap-2 text-xs text-muted-foreground" title={`${path}: ${reason}`}>
            <span className="truncate font-mono">{path}</span>
            <span className="shrink-0">{reason}</span>
          </li>
        ))}
      </ul>
      <a
        href={`https://github.com/${report.notebook}/commit/${report.commit}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-xs text-foreground underline underline-offset-4"
      >
        See them on GitHub
      </a>
    </section>
  );
}
