"use client";

import Link from "next/link";
import { useState } from "react";
import { SourceMode } from "@/components/source-mode";

/** What another device might have done to the note: a new paragraph at the top. */
const remoteChange = (markdown: string) => `A paragraph from another device.\n\n${markdown}`;

interface SourceModeHarnessProps {
  fixtures: string[];
  fixture: string | null;
  initialMarkdown: string;
}

export function SourceModeHarness({ fixtures, fixture, initialMarkdown }: SourceModeHarnessProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [saves, setSaves] = useState(0);

  return (
    <div className="pt-safe pb-safe px-safe">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
        <nav aria-label="Fixtures" className="flex flex-wrap gap-2 text-sm">
          {[null, ...fixtures].map((name) => (
            <Link
              key={name ?? "empty"}
              href={name ? `/dev/source-mode?fixture=${name}` : "/dev/source-mode"}
              aria-current={name === fixture ? "page" : undefined}
              className="rounded-md px-2 py-1 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
            >
              {name ?? "empty"}
            </Link>
          ))}
        </nav>

        <SourceMode
          value={markdown}
          onChange={(next) => {
            setMarkdown(next);
            setSaves((count) => count + 1);
          }}
        />

        <section aria-label="Saved Markdown" className="flex flex-col gap-3 border-t pt-6">
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>
              Saves: <output aria-label="Saves">{saves}</output>
            </p>
            {/* Doesn't take focus, so the cursor stays in the note while the change lands. */}
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setMarkdown(remoteChange)}
              className="pressable rounded-md border px-3 py-1.5 hover:bg-muted"
            >
              Simulate a remote change
            </button>
          </div>
          <pre
            data-testid="saved-markdown"
            className="overflow-x-auto rounded-lg bg-card p-4 font-mono text-xs leading-5 whitespace-pre-wrap"
          >
            {markdown}
          </pre>
        </section>
      </main>
    </div>
  );
}
