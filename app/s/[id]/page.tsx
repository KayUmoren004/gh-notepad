import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isShareId, SHARE_NOTE_FILE, type PublishedNote } from "@/lib/share";
import { shareStoreFromEnv } from "@/lib/share-store";

// Every visit reads the store: a republished or revoked note shows at once.
export const dynamic = "force-dynamic";

/** The published copy under `id`, or `null` when there is none (or the id isn't even one). */
async function publishedNote(id: string): Promise<PublishedNote | null> {
  if (!isShareId(id)) return null;
  const file = await shareStoreFromEnv().get(id, SHARE_NOTE_FILE);
  if (!file) return null;
  try {
    return JSON.parse(new TextDecoder().decode(file.bytes)) as PublishedNote;
  } catch {
    return null;
  }
}

/** `3 Nov 2026`, or nothing for a timestamp that isn't one. */
function updatedOn(updated: string | null): { machine: string; human: string } | null {
  if (!updated) return null;
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) return null;
  return { machine: date.toISOString(), human: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date) };
}

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await params;
  const note = await publishedNote(id);
  return {
    title: note?.title ?? "No longer shared",
    description: note ? "A note shared from Notepad." : "This note is no longer shared.",
    robots: { index: false, follow: false },
    openGraph: { type: "article", title: note?.title ?? "No longer shared", description: "A note shared from Notepad." },
  };
}

/**
 * A shared note, for anyone with the link: the title and rendered body as
 * last synced, with its images, in the app's reading layout. Nothing here
 * needs a session or touches GitHub; the copy comes from the share store.
 */
export default async function SharePage({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const note = await publishedNote(id);
  if (!note) notFound();
  const updated = updatedOn(note.updated);

  return (
    <div className="flex min-h-dvh flex-col px-safe">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 pt-10 pt-safe pb-16 md:pt-16">
        <article>
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-balance wrap-anywhere">{note.title}</h1>
            {updated && (
              <p className="text-sm text-muted-foreground">
                Updated <time dateTime={updated.machine}>{updated.human}</time>
              </p>
            )}
          </header>
          {/* The HTML was rendered on publish with nothing a note could carry onto a public page (lib/share). */}
          <div className="rich-text mt-8" dangerouslySetInnerHTML={{ __html: note.html }} />
        </article>
      </main>
      <footer className="mx-auto w-full max-w-2xl px-6 pb-8 pb-safe text-sm text-muted-foreground">
        <a href="/" className="underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground">
          Shared from Notepad
        </a>
      </footer>
    </div>
  );
}
