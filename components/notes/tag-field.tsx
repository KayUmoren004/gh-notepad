"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { formatNoteCount } from "@/lib/notebook-tree";
import { cleanTags, normalizeTag, tagKey } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { useNote, useNotepad, useTagIndex } from "./notepad-provider";

/** How many existing tags the list under the field offers at once. */
const SUGGESTIONS = 8;
const number = new Intl.NumberFormat("en");

/**
 * A note's tags, under its title: a chip per tag with a way to remove it, and
 * a field to add more. Typing offers the tags already in use, Enter or a comma
 * adds, Backspace on an empty field removes the last tag. Used many times a
 * day, so nothing here animates.
 */
export function TagField({ noteId, className }: { noteId: string; className?: string }) {
  const { store } = useNotepad();
  const note = useNote(noteId);
  const index = useTagIndex();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  /** Which suggestion the arrow keys have reached; `-1` for none, so Enter adds what was typed. */
  const [highlighted, setHighlighted] = useState(-1);
  /** Escape hides the suggestions until the draft changes. */
  const [dismissed, setDismissed] = useState(false);

  const tags = note?.tags ?? [];
  const own = new Set(tags.map(tagKey));
  const query = tagKey(draft);
  // Tags the note doesn't have yet, those starting with what was typed first.
  const matching = index.tags.filter((tag) => !own.has(tag.key) && (query === "" || tag.key.includes(query)));
  const suggestions = [
    ...matching.filter((tag) => tag.key.startsWith(query)),
    ...matching.filter((tag) => !tag.key.startsWith(query)),
  ].slice(0, SUGGESTIONS);
  const open = focused && !dismissed && suggestions.length > 0;
  const active = open && highlighted >= 0 && highlighted < suggestions.length ? highlighted : -1;
  const optionId = (index: number) => `${listId}-${index}`;

  function add(raw: readonly string[]) {
    const added = cleanTags(raw);
    if (added.length > 0) store.setTags(noteId, [...tags, ...added]);
    setDraft("");
    setHighlighted(-1);
    setDismissed(false);
  }

  function remove(tag: string) {
    store.setTags(
      noteId,
      tags.filter((candidate) => candidate !== tag),
    );
  }

  function move(step: 1 | -1) {
    if (suggestions.length === 0) return;
    setDismissed(false);
    const from = active === -1 ? (step === 1 ? -1 : suggestions.length) : active;
    setHighlighted((from + step + suggestions.length) % suggestions.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        if (active >= 0) add([suggestions[active].name]);
        else if (normalizeTag(draft)) add([draft]);
        else input.current?.blur();
        return;
      case ",":
        event.preventDefault();
        add([draft]);
        return;
      case "Backspace":
        if (draft === "" && tags.length > 0) {
          event.preventDefault();
          remove(tags[tags.length - 1]);
        }
        return;
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          setDismissed(true);
          setHighlighted(-1);
        } else if (draft !== "") {
          event.preventDefault();
          setDraft("");
        }
        return;
    }
  }

  if (!note) return null;

  return (
    <div role="group" aria-label="Tags" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-8 max-w-48 shrink-0 items-center gap-0.5 rounded-md bg-muted pl-2 pr-0.5 text-base text-foreground md:h-7"
        >
          <span className="truncate" title={tag}>
            {tag}
          </span>
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={(event) => {
              remove(tag);
              // From the keyboard, focus moves on to the field rather than vanishing with the button.
              if (event.detail === 0) input.current?.focus();
            }}
            className="pressable inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:size-6"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      ))}
      <div className="relative min-w-32 flex-1">
        <input
          ref={input}
          role="combobox"
          aria-label="Add tag"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder="Add tag…"
          value={draft}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDismissed(false);
            setHighlighted(-1);
            // A pasted "a, b, c" adds a, b and keeps c being typed.
            if (!value.includes(",")) {
              setDraft(value);
              return;
            }
            const parts = value.split(",");
            const rest = parts.pop() ?? "";
            const added = cleanTags(parts);
            if (added.length > 0) store.setTags(noteId, [...tags, ...added]);
            setDraft(rest);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setHighlighted(-1);
            if (normalizeTag(draft)) add([draft]);
          }}
          onKeyDown={onKeyDown}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-8 w-full bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:h-7"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Existing tags"
            className="absolute top-full left-0 z-20 mt-1 max-h-56 w-max max-w-[min(18rem,calc(100vw-3rem))] min-w-40 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {suggestions.map((tag, position) => (
              <li
                key={tag.key}
                id={optionId(position)}
                role="option"
                aria-selected={position === active}
                title={`${tag.name}: ${formatNoteCount(tag.count)}`}
                // Keeps the field focused through the click, so its blur doesn't add what was typed instead.
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setHighlighted(position)}
                onClick={() => add([tag.name])}
                className="flex h-9 cursor-default items-center gap-2 rounded-md px-2 text-base select-none aria-selected:bg-accent aria-selected:text-accent-foreground md:h-8 md:text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                <span aria-hidden className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {number.format(tag.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
