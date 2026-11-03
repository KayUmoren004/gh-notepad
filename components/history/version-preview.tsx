"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { ImageHandlerSource, withImageViews } from "@/components/rich-text-mode";
import { richTextExtensions } from "@/lib/rich-text";

/**
 * A version's body shown as it would look in rich text mode, read-only: the
 * same document and styles as the editor, so what the member sees is what a
 * restore would give them. Mount one per version (key it by commit).
 */
export function VersionPreview({ markdown, imageSrc }: { markdown: string; imageSrc?: (src: string) => string }) {
  const handlers = useRef({ imageSrc });
  const [images] = useState(() => new ImageHandlerSource(handlers));
  const [extensions] = useState(() => withImageViews(richTextExtensions({ markdown }), images));

  useEffect(() => {
    handlers.current = { imageSrc };
  });

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: false,
    extensions,
    editorProps: { attributes: { class: "rich-text text-sm leading-6", role: "document", "aria-label": "Version preview" } },
  });

  return editor ? <EditorContent editor={editor} /> : <div aria-busy="true" className="min-h-32" />;
}
