import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NotesApp } from "@/components/notes/notes-app";
import { getSignedInMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Notes" };

/**
 * The app. `/notes` is the notebook tree with nothing open; `/notes/<id>` is
 * a note, by its id, so the link survives renames. Both render the same shell,
 * which reads the id from the URL: switching notes is a history entry, not a
 * page load, and the device store stays open throughout.
 */
export default async function NotesPage({ params }: PageProps<"/notes/[[...note]]">) {
  const member = await getSignedInMember();
  if (!member) redirect("/");
  const { note } = await params;
  if (note && note.length > 1) notFound();

  return (
    <div data-app-shell className="flex h-dvh overflow-hidden px-safe">
      <NotesApp member={{ id: member.id, login: member.login, avatarUrl: member.avatarUrl }} />
    </div>
  );
}
