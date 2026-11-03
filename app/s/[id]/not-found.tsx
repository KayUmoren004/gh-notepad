/** A share link that leads nowhere: revoked, mistyped, or never one. Answered with a 404. */
export default function ShareNotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-safe">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-2 px-6 py-16 pt-safe">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">This note is no longer shared</h1>
        <p className="text-pretty text-muted-foreground">
          Whoever shared it stopped sharing, or the link isn&apos;t one. Ask them for a new link.
        </p>
      </main>
      <footer className="mx-auto w-full max-w-2xl px-6 pb-8 pb-safe text-sm text-muted-foreground">
        <a href="/" className="underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground">
          Shared from Notepad
        </a>
      </footer>
    </div>
  );
}
