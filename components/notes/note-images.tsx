"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ImageHandlers, PickedImage, PickImage } from "@/components/rich-text-mode";
import { attachmentUrl, IMAGE_ACCEPT, imageProblem, linkToAttachmentPath } from "@/lib/attachments";
import type { Note } from "@/lib/device-store";
import { useNotepad } from "./notepad-provider";

/** How long a refusal stays on screen. */
const NOTICE_MS = 6_000;

export interface NoteImages {
  /** Rich text mode's image props: picking, pasting and dropping, and where images load from. */
  editorProps: ImageHandlers & { onPickImage: PickImage };
  /** The file picker and, after a refused file, the reason; rendered beside the note body. */
  element: ReactNode;
}

/** A file's name without its extension, as the image's alt text; a pasted screenshot has no useful name. */
function altFor(file: File): string {
  const name = file.name.replace(/\.[^.]+$/, "");
  return /^(image|screenshot|blob)?$/i.test(name) ? "" : name;
}

/**
 * Images for one note's editor: a picked, pasted or dropped file is checked,
 * stored on the device as an attachment (ADR 0003) and inserted at once; the
 * note links it from the notebook root. Images load from the device's copy
 * while it has one, otherwise from the notebook through the app.
 */
export function useNoteImages(note: Note | undefined): NoteImages {
  const { store } = useNotepad();
  const notebook = note?.notebook ?? store.personalNotebook;
  const [notice, setNotice] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const picking = useRef<((image: PickedImage | null) => void) | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Closing the picker without choosing settles the pick; React has no prop for the `cancel` event.
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const cancelled = () => {
      picking.current?.(null);
      picking.current = null;
    };
    input.addEventListener("cancel", cancelled);
    return () => input.removeEventListener("cancel", cancelled);
  }, []);

  const attach = useCallback(
    (file: File): PickedImage | null => {
      const problem = imageProblem(file);
      if (problem) {
        setNotice(problem);
        return null;
      }
      setNotice(null);
      return { src: store.addAttachment(notebook, { type: file.type, bytes: file }), alt: altFor(file) };
    },
    [store, notebook],
  );

  const onPickImage = useCallback(
    () =>
      new Promise<PickedImage | null>((resolve) => {
        picking.current?.(null);
        picking.current = resolve;
        picker.current?.click();
      }),
    [],
  );

  const onImageFile = useCallback(async (file: File) => attach(file), [attach]);

  const imageSrc = useCallback(
    (src: string) => {
      const path = linkToAttachmentPath(src);
      if (!path) return src;
      const device = store.attachmentSrc(notebook, path);
      if (device) return device;
      const location = store.sync.notebook(notebook);
      return location?.branch ? attachmentUrl({ ...location, branch: location.branch }, path) : src;
    },
    [store, notebook],
  );

  return {
    editorProps: { onPickImage, onImageFile, imageSrc },
    element: (
      <>
        <input
          ref={picker}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            // Picking the same file again must count as a new pick.
            event.currentTarget.value = "";
            picking.current?.(file ? attach(file) : null);
            picking.current = null;
          }}
        />
        {notice && (
          <p role="alert" className="animate-enter text-sm text-destructive">
            {notice}
          </p>
        )}
      </>
    ),
  };
}
