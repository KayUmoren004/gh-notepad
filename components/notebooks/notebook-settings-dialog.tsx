"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useNotepad, type NotebookSummary } from "@/components/notes/notepad-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RemoteError, type Collaborator, type NotebookInvitation } from "@/lib/remote";
import { cn } from "@/lib/utils";
import { usernameToInvite } from "./notebook-name";

type People =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "loaded"; collaborators: Collaborator[]; invitations: NotebookInvitation[] };

/**
 * Who can open a shared notebook: its collaborators, and (for its owner) the
 * invitations still open, with a field to invite someone by GitHub username.
 * GitHub grants every collaborator on a personal account's repository write
 * access, so there is nothing to choose: everyone invited can edit everything.
 */
export function NotebookSettingsDialog({
  notebook,
  open,
  onOpenChange,
  onLeave,
}: {
  notebook: NotebookSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For a collaborator: offers to leave the notebook (the owner can't leave their own). */
  onLeave?: () => void;
}) {
  const { store, remote } = useNotepad();
  const owner = notebook.role === "owner";
  const ref = { owner: notebook.owner, repo: notebook.repo };
  const [attempt, setAttempt] = useState(0);
  // What was loaded, and for which opening: another opening (or Try again) starts from "loading" again.
  const request = open ? `${attempt}\u0000${notebook.id}` : null;
  const [answer, setAnswer] = useState<{ request: string; people: People } | null>(null);
  const people: People = answer && answer.request === request ? answer.people : { state: "loading" };
  const setPeople = (next: People) => {
    if (request !== null) setAnswer({ request, people: next });
  };

  useEffect(() => {
    if (request === null) return;
    let cancelled = false;
    Promise.all([
      remote.listCollaborators({ owner: notebook.owner, repo: notebook.repo }),
      owner ? remote.listInvitations({ owner: notebook.owner, repo: notebook.repo }) : Promise.resolve([]),
    ]).then(
      ([collaborators, invitations]) => {
        if (!cancelled) setAnswer({ request, people: { state: "loaded", collaborators, invitations } });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "Couldn't load";
        if (!cancelled) setAnswer({ request, people: { state: "failed", message } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [request, owner, notebook.owner, notebook.repo, remote]);

  const loaded = people.state === "loaded" ? people : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate" title={`${notebook.owner}/${notebook.repo}`}>
            {notebook.name}
          </DialogTitle>
          <DialogDescription>
            {owner
              ? "A shared notebook you own. Everyone you invite can read and edit all of it."
              : `A shared notebook owned by ${notebook.owner}. Everyone in it can read and edit all of it.`}
          </DialogDescription>
        </DialogHeader>

        {owner && loaded && (
          <InviteForm
            notebook={ref}
            onInvited={(invitation) =>
              setPeople({ ...loaded, invitations: [...loaded.invitations.filter((other) => other.id !== invitation.id), invitation] })
            }
          />
        )}

        {people.state === "loading" && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {people.state === "failed" && (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{people.message}</span>
            <Button variant="outline" size="xs" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </Button>
          </p>
        )}
        {loaded && (
          <>
            <PeopleList
              heading="Collaborators"
              people={loaded.collaborators.map((person) => ({
                key: person.login,
                login: person.login,
                avatarUrl: person.avatarUrl,
                tag: person.role === "owner" ? "Owner" : person.login.toLowerCase() === store.account.login.toLowerCase() ? "You" : null,
                action:
                  owner && person.role !== "owner"
                    ? {
                        label: "Remove",
                        name: `Remove ${person.login}`,
                        run: async () => {
                          await remote.removeCollaborator(ref, person.login);
                          setPeople({ ...loaded, collaborators: loaded.collaborators.filter((other) => other.login !== person.login) });
                        },
                      }
                    : null,
              }))}
            />
            {owner && loaded.invitations.length > 0 && (
              <PeopleList
                heading="Invited"
                people={loaded.invitations.map((invitation) => ({
                  key: String(invitation.id),
                  login: invitation.invitee,
                  avatarUrl: null,
                  tag: invitation.expired ? "Expired" : null,
                  action: {
                    label: "Cancel",
                    name: `Cancel the invitation to ${invitation.invitee}`,
                    run: async () => {
                      await remote.cancelInvitation(ref, invitation.id);
                      setPeople({ ...loaded, invitations: loaded.invitations.filter((other) => other.id !== invitation.id) });
                    },
                  },
                }))}
              />
            )}
          </>
        )}

        <DialogFooter className={cn(onLeave && "sm:justify-between")}>
          {onLeave && (
            <Button variant="outline" onClick={onLeave}>
              Leave notebook…
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  notebook,
  onInvited,
}: {
  notebook: { owner: string; repo: string };
  onInvited: (invitation: NotebookInvitation) => void;
}) {
  const { remote } = useNotepad();
  const statusId = useId();
  const [typed, setTyped] = useState("");
  const [inviting, setInviting] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const username = usernameToInvite(typed);
  const canInvite = username !== null && !inviting;

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!username) return;
    setInviting(true);
    setStatus(null);
    try {
      const outcome = await remote.invite(notebook, username);
      if (outcome.status === "invited") {
        onInvited(outcome.invitation);
        setStatus({ tone: "ok", text: `Invited ${username}. GitHub lets them know.` });
      } else {
        setStatus({ tone: "ok", text: `${username} already has this notebook.` });
      }
      setTyped("");
    } catch (error) {
      const code = error instanceof RemoteError ? error.code : undefined;
      setStatus({
        tone: "problem",
        text:
          code === "no_such_user"
            ? `GitHub has no user named ${username}`
            : error instanceof Error
              ? error.message
              : "The invitation couldn't be sent",
      });
    } finally {
      setInviting(false);
    }
  }

  return (
    <form onSubmit={(event) => void invite(event)} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          aria-label="GitHub username to invite"
          aria-describedby={statusId}
          placeholder="GitHub username"
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={40}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
            setStatus(null);
          }}
        />
        <Button type="submit" disabled={!canInvite}>
          {inviting ? "Inviting…" : "Invite"}
        </Button>
      </div>
      <p
        id={statusId}
        role={status?.tone === "problem" ? "alert" : "status"}
        className={cn("min-h-4 text-xs", status?.tone === "problem" ? "text-destructive" : "text-muted-foreground")}
      >
        {status?.text ?? (typed && !username ? "A GitHub username: letters, digits and single hyphens" : "")}
      </p>
    </form>
  );
}

interface Person {
  key: string;
  login: string;
  avatarUrl: string | null;
  tag: string | null;
  action: { label: string; name: string; run: () => Promise<void> } | null;
}

function PeopleList({ heading, people }: { heading: string; people: Person[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground select-none">
        {heading}
        <span className="tabular-nums">{people.length.toLocaleString()}</span>
      </h3>
      <ul className="-mx-1 flex max-h-56 flex-col overflow-y-auto overscroll-contain">
        {people.map((person) => (
          <PersonRow key={person.key} person={person} />
        ))}
      </ul>
    </section>
  );
}

function PersonRow({ person }: { person: Person }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function act() {
    if (!person.action) return;
    setBusy(true);
    setFailure(null);
    try {
      await person.action.run();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "That didn't work");
      setBusy(false);
    }
  }

  return (
    <li className="flex min-h-9 items-center gap-2 rounded-md px-1 py-1 text-sm">
      <Avatar className="size-6">
        {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
        <AvatarFallback className="text-xs">{person.login.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate" title={person.login}>
        {person.login}
      </span>
      {person.tag && <span className="shrink-0 text-xs text-muted-foreground">{person.tag}</span>}
      {failure && (
        <span role="alert" className="max-w-32 shrink-0 truncate text-xs text-destructive" title={failure}>
          {failure}
        </span>
      )}
      {person.action && (
        <Button variant="ghost" size="xs" aria-label={person.action.name} disabled={busy} className="shrink-0 text-muted-foreground" onClick={() => void act()}>
          {person.action.label}
        </Button>
      )}
    </li>
  );
}
