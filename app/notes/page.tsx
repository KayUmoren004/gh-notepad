import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getSignedInMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Notes" };

/** The app shell, still empty: the layout ticket fills it with the sidebar and editor. */
export default async function NotesPage() {
  const member = await getSignedInMember();
  if (!member) redirect("/");

  return (
    <div data-app-shell className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background pt-safe px-safe">
        <div className="flex h-12 items-center justify-between gap-4 px-4">
          <span className="text-sm font-medium">Notepad</span>
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarImage src={member.avatarUrl} alt={member.login} />
              <AvatarFallback>{member.login.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-y-auto overscroll-contain px-safe pb-safe">
        <p className="px-6 text-center text-muted-foreground">Your notes will appear here.</p>
      </main>
    </div>
  );
}
