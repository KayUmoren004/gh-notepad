"use client";

import { useMemo } from "react";
import { diffLines, type DiffHunk } from "@/lib/history";
import { cn } from "@/lib/utils";
import { hiddenLinesLabel } from "./format";

const MARK: Record<Exclude<DiffHunk["kind"], "gap">, string> = { unchanged: " ", added: "+", removed: "−" };

/**
 * What changed between a version and the note now, line by line: lines the
 * note has gained tinted green, lines it has lost tinted red, with a little
 * context and the rest folded.
 */
export function LineDiff({ before, after }: { before: string; after: string }) {
  const hunks = useMemo(() => diffLines(before, after), [before, after]);
  const unchanged = hunks.every((hunk) => hunk.kind === "unchanged" || hunk.kind === "gap");

  if (unchanged) {
    return <p className="px-3 py-6 text-center text-sm text-pretty text-muted-foreground">This version matches the note as it is now.</p>;
  }

  return (
    <div className="font-mono text-[13px] leading-6" aria-label="Changes since this version">
      {hunks.map((hunk, index) =>
        hunk.kind === "gap" ? (
          <p key={index} className="my-1 border-y border-dashed px-3 text-xs text-muted-foreground select-none">
            {hiddenLinesLabel(hunk.hidden)}
          </p>
        ) : (
          hunk.lines.map((line, lineIndex) => (
            <div
              key={`${index}-${lineIndex}`}
              className={cn(
                "flex gap-2 px-3 whitespace-pre-wrap",
                hunk.kind === "added" && "bg-diff-added/15",
                hunk.kind === "removed" && "bg-diff-removed/15 text-muted-foreground",
              )}
              data-change={hunk.kind === "unchanged" ? undefined : hunk.kind}
            >
              <span aria-hidden className="w-3 shrink-0 text-muted-foreground select-none">
                {MARK[hunk.kind]}
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="sr-only">{hunk.kind === "added" ? "Added: " : hunk.kind === "removed" ? "Removed: " : ""}</span>
                {line === "" ? " " : line}
              </span>
            </div>
          ))
        ),
      )}
    </div>
  );
}
