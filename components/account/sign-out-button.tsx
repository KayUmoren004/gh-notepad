"use client";

import { useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteDeviceData, unsyncedNotes, type Account, type UnsyncedNote } from "@/lib/device-store";

/** The titles named in the warning; the rest are counted. */
const TITLES_SHOWN = 5;

type Step =
  /** Keep the notes on this device (the default) or remove them. */
  | { kind: "choose" }
  /** Removing would lose these notes' unsynced edits: the member confirms. */
  | { kind: "confirm"; notes: UnsyncedNote[] };

/**
 * Signs the member out, asking whether this device keeps their notes. Keeping
 * them means signing back in here is instant; removing them deletes the
 * account's device data first, with a warning when that loses unsynced edits.
 * Self-contained: it works wherever the signed-in shell puts it.
 */
export function SignOutButton({ account }: { account: Account }) {
  const formId = useId();
  const keepId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);

  function onOpenChange(next: boolean) {
    // Reset when opening, not closing, so the content stays put while the dialog fades out.
    if (next) {
      setStep({ kind: "choose" });
      setFailed(false);
    }
    setOpen(next);
  }

  async function remove() {
    setRemoving(true);
    setFailed(false);
    try {
      await deleteDeviceData(account);
    } catch (error) {
      console.error("Removing this account's notes from the device failed", error);
      setFailed(true);
      setRemoving(false);
      return;
    }
    // The sign-out itself is a plain form post: the service worker forgets the signed-in shell on seeing it.
    formRef.current?.requestSubmit();
  }

  async function chooseRemove() {
    setRemoving(true);
    const notes = await unsyncedNotes(account).catch(() => [] as UnsyncedNote[]);
    if (notes.length > 0) {
      setRemoving(false);
      setStep({ kind: "confirm", notes });
      return;
    }
    await remove();
  }

  return (
    <>
      <form ref={formRef} id={formId} action="/api/auth/logout" method="post" hidden />
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Sign out</AlertDialogTrigger>
        <AlertDialogContent
          // Enter takes the default choice: focus starts on "Keep", the safe one.
          initialFocus={() => document.getElementById(keepId)}
          className="duration-200 ease-out motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100"
        >
          {step.kind === "choose" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out?</AlertDialogTitle>
                <AlertDialogDescription>
                  Keep your notes on this device and signing back in here is instant. Remove them if this device
                  isn&apos;t yours. Synced notes are in your notebooks on GitHub either way.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {failed && <RemovalFailed />}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="outline" disabled={removing} onClick={() => void chooseRemove()}>
                  {removing ? "Removing…" : "Remove notes from this device"}
                </AlertDialogAction>
                <AlertDialogAction id={keepId} type="submit" form={formId} disabled={removing}>
                  Keep notes on this device
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove unsynced changes?</AlertDialogTitle>
                <AlertDialogDescription render={<div />}>
                  <UnsyncedNotes notes={step.notes} />
                </AlertDialogDescription>
              </AlertDialogHeader>
              {failed && <RemovalFailed />}
              <AlertDialogFooter>
                <AlertDialogCancel autoFocus disabled={removing}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={removing} onClick={() => void remove()}>
                  {removing ? "Removing…" : "Remove anyway"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** What removing loses: how many notes, which (the first few, in full), and that the loss is for good. */
function UnsyncedNotes({ notes }: { notes: UnsyncedNote[] }) {
  const count = notes.length;
  const shown = notes.slice(0, TITLES_SHOWN);
  const more = count - shown.length;
  return (
    <>
      <p>
        {count === 1
          ? "1 note has changes that haven't synced to GitHub:"
          : `${count.toLocaleString()} notes have changes that haven't synced to GitHub:`}
      </p>
      <ul className="my-2 list-disc space-y-0.5 pl-5 text-left text-foreground">
        {shown.map((note) => (
          <li key={note.id}>
            {/* The span truncates, not the item: `overflow: hidden` on the item would clip its bullet. */}
            <span className="block truncate" title={note.title}>
              {note.title}
            </span>
          </li>
        ))}
        {more > 0 && <li className="list-none text-muted-foreground">and {more.toLocaleString()} more</li>}
      </ul>
      <p>Removing {count === 1 ? "it" : "them"} from this device loses those changes.</p>
    </>
  );
}

function RemovalFailed() {
  return (
    <p role="alert" className="text-sm text-destructive">
      Removing your notes from this device didn&apos;t work, so you&apos;re still signed in. Try again, or keep them on
      this device.
    </p>
  );
}
