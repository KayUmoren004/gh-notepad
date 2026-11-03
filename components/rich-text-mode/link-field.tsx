"use client";

import type { Editor } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import { Check, ExternalLink, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ToolbarButton } from "./toolbar-button";

/** A typed address as a link target: `example.com` gets `https://`, an email address gets `mailto:`. */
export function linkTarget(address: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) || /^(\/|#|\.\.?\/)/.test(address)) return address;
  if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(address)) return `mailto:${address}`;
  return `https://${address}`;
}

interface LinkFieldProps {
  editor: Editor;
  onDone: () => void;
  size?: "default" | "touch";
}

/** Adds, changes or removes the link on the selection (or on the link around the cursor). */
export function LinkField({ editor, onDone, size = "default" }: LinkFieldProps) {
  const current: string = editor.getAttributes("link").href ?? "";
  const [address, setAddress] = useState(current);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (change: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
    change(editor.chain().focus().extendMarkRange("link")).run();
    onDone();
  };
  const apply = () => {
    const value = address.trim();
    finish((chain) => (value ? chain.setLink({ href: linkTarget(value) }) : chain.unsetLink()));
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        ref={input}
        type="text"
        inputMode="url"
        enterKeyHint="done"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Link address"
        placeholder="Paste or type a link"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.commands.focus();
            onDone();
          }
        }}
        className={cn(
          "min-w-0 flex-1 rounded-md bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground",
          size === "touch" ? "h-11" : "h-8 w-56 pointer-fine:text-sm",
        )}
      />
      <ToolbarButton icon={Check} label="Apply link" size={size} onClick={apply} />
      {current && (
        <ToolbarButton icon={Unlink} label="Remove link" size={size} onClick={() => finish((chain) => chain.unsetLink())} />
      )}
      {/* Notes from shared notebooks are untrusted: only safe protocols open. */}
      {current && isAllowedUri(current) && (
        <a
          href={current}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open link"
          title="Open link"
          className={cn(
            "pressable inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            size === "touch" ? "size-11 [&_svg]:size-5" : "size-8 [&_svg]:size-4",
          )}
        >
          <ExternalLink aria-hidden />
        </a>
      )}
    </div>
  );
}
