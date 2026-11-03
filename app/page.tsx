import type { Metadata } from "next";
import { NotebookPen } from "lucide-react";
import { redirect } from "next/navigation";
import { GitHubMark } from "@/components/github-mark";
import { AppPreview } from "@/components/landing/app-preview";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { buttonVariants } from "@/components/ui/button-variants";
import { getSignedInMember } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Notepad: your notes, in your own GitHub" },
  alternates: { canonical: "/" },
};

const notices = {
  failed: "Sign-in didn't finish. Please try again.",
  cancelled: "Sign-in was cancelled on GitHub.",
} as const;

/** The landing page for signed-out visitors; members go straight to their notes. */
export default async function LandingPage({ searchParams }: PageProps<"/">) {
  if (await getSignedInMember()) redirect("/notes");

  const outcome = (await searchParams)["sign-in"];
  const notice = outcome === "failed" || outcome === "cancelled" ? notices[outcome] : null;

  return (
    <div className="flex min-h-svh flex-col px-safe">
      <header className="pt-safe">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-5 md:h-16 md:px-8">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <NotebookPen className="size-4" aria-hidden="true" />
            </span>
            Notepad
          </span>
        </div>
      </header>

      <main className="flex-1">
        {/* First-load motion: each block fades up in turn, once; reduced motion keeps only the fade. */}
        <section aria-labelledby="hero-title" className="mx-auto w-full max-w-6xl px-5 pt-10 text-center md:px-8 md:pt-20">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 md:gap-6">
            <h1
              id="hero-title"
              className="animate-enter text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl"
            >
              Your notes,
              <br /> in your own GitHub
            </h1>
            <p className="animate-enter text-lg text-pretty text-muted-foreground delay-50 md:text-xl">
              Write in rich text. Every note is saved as a plain Markdown file in a private repository on your GitHub
              account, and it all keeps working offline.
            </p>
            <div className="flex w-full animate-enter flex-col items-center gap-4 pt-2 delay-100">
              {notice && (
                <p role="alert" className="w-full max-w-sm rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
                  {notice}
                </p>
              )}
              <a
                href="/api/auth/login"
                className={cn(buttonVariants({ size: "lg" }), "h-11 w-full max-w-sm gap-2 px-5 text-base sm:w-auto")}
              >
                <GitHubMark className="size-5" />
                Sign in with GitHub
              </a>
              <p className="max-w-sm text-sm text-pretty text-muted-foreground">
                This notepad is invite-only. The person who runs it decides which GitHub accounts can sign in.
              </p>
            </div>
          </div>

          <AppPreview className="mx-auto mt-14 max-w-md animate-enter delay-150 md:mt-20 md:max-w-none md:mask-b-from-75%" />
        </section>

        <FeatureGrid />
      </main>

      <footer className="border-t pb-safe">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
          <span className="font-medium text-foreground">Notepad</span>
          <span>Invite-only. Your notes stay in your GitHub account.</span>
        </div>
      </footer>
    </div>
  );
}
