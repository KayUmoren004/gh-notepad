import { redirect } from "next/navigation";
import { GitHubMark } from "@/components/github-mark";
import { buttonVariants } from "@/components/ui/button-variants";
import { getSignedInMember } from "@/lib/auth";
import { cn } from "@/lib/utils";

const notices = {
  failed: "Sign-in didn't finish. Please try again.",
  cancelled: "Sign-in was cancelled on GitHub.",
} as const;

/** Placeholder landing page; its real design comes in a later ticket. */
export default async function LandingPage({ searchParams }: PageProps<"/">) {
  if (await getSignedInMember()) redirect("/notes");

  const outcome = (await searchParams)["sign-in"];
  const notice = outcome === "failed" || outcome === "cancelled" ? notices[outcome] : null;

  return (
    <main className="flex min-h-svh items-center justify-center px-safe">
      <div className="flex w-full max-w-sm animate-enter flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Notepad</h1>
          <p className="text-pretty text-muted-foreground">
            Notes kept as Markdown files in your own GitHub repositories, on every device, online or not.
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          {notice && (
            <p role="alert" className="w-full rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
              {notice}
            </p>
          )}
          <a href="/api/auth/login" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full gap-2 px-5 text-base")}>
            <GitHubMark className="size-5" />
            Sign in with GitHub
          </a>
          <p className="text-sm text-muted-foreground">Invite only.</p>
        </div>
      </div>
    </main>
  );
}
