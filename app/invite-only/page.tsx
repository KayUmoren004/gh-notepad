import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Invite only" };

/** GitHub's login rule; anything else in the query string is not shown. */
const githubLogin = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export default async function InviteOnlyPage({ searchParams }: PageProps<"/invite-only">) {
  const { login } = await searchParams;
  const shownLogin = typeof login === "string" && githubLogin.test(login) ? login : null;

  return (
    <main className="flex min-h-svh items-center justify-center px-safe">
      <div className="flex w-full max-w-sm animate-enter flex-col items-center gap-6 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-balance">This notepad is invite-only</h1>
          <p className="text-pretty text-muted-foreground">
            {shownLogin ? (
              <>
                The GitHub account <span className="font-medium wrap-anywhere text-foreground">@{shownLogin}</span>{" "}
                isn&apos;t on its guest list.
              </>
            ) : (
              "Your GitHub account isn't on its guest list."
            )}{" "}
            Ask the person who runs it to add your GitHub username, then sign in again.
          </p>
        </div>

        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 w-full px-5 text-base")}>
          Back to the start
        </Link>
      </div>
    </main>
  );
}
