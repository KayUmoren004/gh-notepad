import { CloudOff, FileText, History, Share2, Type, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What the notepad does, for the landing page. */
export function FeatureGrid() {
  return (
    <section aria-labelledby="features-title" className="mx-auto w-full max-w-6xl px-5 py-24 md:px-8 md:py-32">
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 id="features-title" className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Plain files underneath, a proper editor on top
        </h2>
        <p className="text-pretty text-muted-foreground md:text-lg">
          Your notebook is a GitHub repository, so your notes outlive any app, this one included.
        </p>
      </div>

      <div className="mt-12 grid gap-3 md:grid-cols-3">
        <Feature
          icon={FileText}
          title="Markdown files in your GitHub"
          className="md:col-span-2 md:flex-row md:gap-8"
          visual={<NoteFile className="md:flex-1" />}
        >
          <p>
            Each note is a <code className="font-mono text-sm text-foreground">.md</code> file named after its title, in a
            private <code className="font-mono text-sm text-foreground">my-notes</code> repository on your account. Read
            it on github.com or edit it in any editor, and the change shows up here.
          </p>
        </Feature>

        <Feature icon={CloudOff} title="Works offline">
          <p>
            Everything you type is saved on this device first, so a lost connection never costs a word. It syncs on its
            own when you&apos;re back, and edits from two devices merge.
          </p>
        </Feature>

        <Feature icon={Type} title="Rich text or raw Markdown">
          <p>
            Type <kbd className="font-mono text-sm text-foreground">/</kbd> for headings, task lists, tables and code, or
            use Markdown shortcuts as you go. Source mode shows the exact text.
          </p>
        </Feature>

        <Feature icon={History} title="Version history">
          <p>Every editing session becomes a version. Preview any of them, see what changed, and restore one safely.</p>
        </Feature>

        <Feature icon={Share2} title="Sharing">
          <p>
            Send anyone a read-only link to a note, or invite people to a shared notebook you can all edit. GitHub keeps
            track of who has access.
          </p>
        </Feature>
      </div>
    </section>
  );
}

function Feature({
  icon: Icon,
  title,
  visual,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Shown beside the text on wide screens, below it on narrow ones. */
  visual?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={cn("flex flex-col gap-6 rounded-xl border bg-card p-6", className)}>
      <div className="flex flex-col gap-4 md:flex-1">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-2 text-pretty text-muted-foreground">
          <h3 className="font-medium text-foreground">{title}</h3>
          {children}
        </div>
      </div>
      {visual}
    </article>
  );
}

/** The note from the preview as it sits in the repository. */
function NoteFile({ className }: { className?: string }) {
  const frontmatter = ["---", "tags: [home, outside]", "created: 2026-10-12", "updated: 2026-10-31", "---"];
  const body = ["- [x] Measure the fence line", "- [x] Pick up cedar boards", "- [ ] Build the first bed"];
  return (
    <figure className={cn("flex flex-col overflow-hidden rounded-lg border bg-background", className)}>
      <figcaption className="border-b px-4 py-2 font-mono text-xs text-muted-foreground">Projects/Garden plan.md</figcaption>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-5">
        <code>
          <span className="text-muted-foreground">{frontmatter.join("\n")}</span>
          {"\n\n"}
          <span className="font-semibold">## This weekend</span>
          {"\n\n"}
          {body.join("\n")}
        </code>
      </pre>
    </figure>
  );
}
