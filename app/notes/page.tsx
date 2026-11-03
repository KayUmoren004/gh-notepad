import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/account/sign-out-button";
import { NotesApp } from "@/components/notes/notes-app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getSignedInMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Notes" };

/** The app shell around the notes screen; the layout ticket replaces it with the sidebar and editor layout. */
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
            <SignOutButton account={{ id: member.id, login: member.login }} />
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-safe">
        <NotesApp account={{ id: member.id, login: member.login }} />
      </main>
    </div>
  );
}
