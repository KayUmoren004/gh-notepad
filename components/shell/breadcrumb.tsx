"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Fold {
  /** The segments and the room this fold was worked out for; any change starts afresh. */
  key: string;
  width: number;
  /** How many middle segments are folded into "…". */
  count: number;
}

/**
 * `notebook / folder / … / note`. Each segment truncates on its own, and when
 * the row still doesn't fit, the segments in the middle fold into one "…"
 * (nearest the notebook first), so the notebook and the note always show.
 */
export function Breadcrumb({ segments, className }: { segments: readonly string[]; className?: string }) {
  const list = useRef<HTMLOListElement>(null);
  const key = segments.join("\u0000");
  const [width, setWidth] = useState(0);
  const [fold, setFold] = useState<Fold>({ key, width, count: 0 });
  const middle = segments.slice(1, -1);
  const folded = fold.key === key && fold.width === width ? fold.count : 0;

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Folds one more segment per render until the row fits: a handful of renders at most.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && element.scrollWidth > element.clientWidth + 1 && folded < middle.length) {
      setFold({ key, width, count: folded + 1 });
    }
  }, [key, width, folded, middle.length]);

  const visible: { text: string; title: string; kind: "first" | "middle" | "fold" | "last" }[] = [];
  if (segments.length > 0) visible.push({ text: segments[0], title: segments[0], kind: "first" });
  if (folded > 0) visible.push({ text: "…", title: middle.slice(0, folded).join(" / "), kind: "fold" });
  for (const text of middle.slice(folded)) visible.push({ text, title: text, kind: "middle" });
  if (segments.length > 1) visible.push({ text: segments.at(-1)!, title: segments.at(-1)!, kind: "last" });

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0 flex-1", className)}>
      <ol ref={list} className="flex min-w-0 items-center gap-1 overflow-hidden text-sm whitespace-nowrap">
        {visible.map((segment, index) => (
          <Fragment key={`${segment.kind}-${index}`}>
            {index > 0 && (
              <li aria-hidden className="shrink-0 text-muted-foreground/60">
                <ChevronRight className="size-3.5" />
              </li>
            )}
            <li
              title={segment.title}
              aria-current={segment.kind === "last" ? "page" : undefined}
              className={cn(
                "truncate",
                segment.kind === "last" ? "min-w-16 text-foreground" : "text-muted-foreground",
                segment.kind === "first" && "max-w-40 shrink-0",
                segment.kind === "middle" && "max-w-48 min-w-12",
                segment.kind === "fold" && "shrink-0",
              )}
            >
              {segment.text}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
