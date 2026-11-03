"use client";

import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { BLOCKS, type Block, matchBlocks } from "./blocks";

/** An image the member picked, to insert at the cursor. */
export interface PickedImage {
  src: string;
  alt?: string;
}

export type PickImage = () => Promise<PickedImage | null>;

interface MenuState {
  open: boolean;
  items: Block[];
  index: number;
  side: "top" | "bottom";
  /** Opened by a pointer, so it animates in; typing `/` opens it instantly. */
  animate: boolean;
}

const CLOSED: MenuState = { open: false, items: [], index: 0, side: "bottom", animate: false };
const slashMenuKey = new PluginKey("slashMenu");

/** The slash menu's state, shared by the suggestion plugin that drives it and the component that draws it. */
export class SlashMenuStore {
  /** Where the menu is drawn; the suggestion plugin positions it at the cursor. */
  readonly element = typeof document === "undefined" ? null : document.createElement("div");
  private state = CLOSED;
  private readonly listeners = new Set<() => void>();
  private props: SuggestionProps<Block, Block> | null = null;
  private unmount: (() => void) | null = null;
  private animateNext = false;

  /** `options.current.onPickImage` is the current way to pick an image, if images can be inserted. */
  constructor(private readonly options: RefObject<{ onPickImage?: PickImage }>) {}

  get pickImage(): PickImage | undefined {
    return this.options.current.onPickImage;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Opens the menu at the cursor from a button (the phone's insert button), so it animates in. */
  openFromPointer(editor: Editor) {
    this.animateNext = true;
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset);
    editor.chain().focus().insertContent(before && !/\s$/.test(before) ? " /" : "/").run();
  }

  start(props: SuggestionProps<Block, Block>) {
    this.props = props;
    const element = this.element;
    if (element) {
      element.style.visibility = "hidden";
      element.style.zIndex = "50";
      this.unmount = props.mount(element, {
        onPosition: ({ x, y, placement, strategy }) => {
          Object.assign(element.style, { position: strategy, left: `${x}px`, top: `${y}px`, visibility: "" });
          const side = placement.startsWith("top") ? "top" : "bottom";
          if (side !== this.state.side) this.set({ side });
        },
      });
    }
    this.set({ open: true, items: props.items, index: 0, side: "bottom", animate: this.animateNext });
    this.animateNext = false;
  }

  update(props: SuggestionProps<Block, Block>) {
    const queryChanged = props.query !== this.props?.query;
    this.props = props;
    this.set({ items: props.items, index: queryChanged ? 0 : Math.min(this.state.index, Math.max(props.items.length - 1, 0)) });
  }

  keyDown(event: KeyboardEvent): boolean {
    const { items, index } = this.state;
    if (event.key === "Escape") {
      if (this.props) exitSuggestion(this.props.editor.view, slashMenuKey);
      return true;
    }
    if (!items.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.set({ index: (index + step + items.length) % items.length });
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      this.choose(index);
      return true;
    }
    return false;
  }

  exit() {
    this.unmount?.();
    this.unmount = null;
    this.props = null;
    this.set(CLOSED);
  }

  choose(index: number) {
    const block = this.state.items[index];
    if (block && this.props) this.props.command(block);
  }

  highlight(index: number) {
    if (index !== this.state.index) this.set({ index });
  }

  private set(patch: Partial<MenuState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

async function insertBlock(editor: Editor, range: Range, block: Block, pickImage: PickImage | undefined) {
  if (block.apply) {
    block.apply(editor.chain().focus().deleteRange(range)).run();
    return;
  }
  editor.chain().focus().deleteRange(range).run();
  const image = await pickImage?.();
  if (image) editor.chain().focus().setImage({ src: image.src, alt: image.alt ?? "" }).run();
}

/** `/` opens a menu of blocks (headings, lists, tables, …) that turns the current block into one. */
export const SlashCommand = Extension.create<{ store: SlashMenuStore | null }>({
  name: "slashCommand",

  addOptions() {
    return { store: null };
  },

  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) return [];
    return [
      Suggestion<Block, Block>({
        editor: this.editor,
        pluginKey: slashMenuKey,
        char: "/",
        // Not inside code, where `/` is just a character.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => matchBlocks(store.pickImage ? BLOCKS : BLOCKS.filter((block) => block.id !== "image"), query),
        command: ({ editor, range, props }) => void insertBlock(editor, range, props, store.pickImage),
        render: () => ({
          onStart: (props) => store.start(props),
          onUpdate: (props) => store.update(props),
          onKeyDown: ({ event }) => store.keyDown(event),
          onExit: () => store.exit(),
        }),
      }),
    ];
  },
});

/** The slash menu, drawn into the element the suggestion plugin keeps at the cursor. */
export function SlashMenu({ store }: { store: SlashMenuStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => CLOSED);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [state.index]);

  if (!state.open || !store.element) return null;

  return createPortal(
    <div
      ref={list}
      role="listbox"
      aria-label="Insert block"
      data-side={state.side}
      data-animate={state.animate}
      className={cn(
        "max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
        "data-[side=bottom]:origin-top-left data-[side=top]:origin-bottom-left",
        "data-[animate=true]:animate-in data-[animate=true]:fade-in-0 data-[animate=true]:duration-150 data-[animate=true]:ease-out",
        "motion-safe:data-[animate=true]:zoom-in-95 motion-safe:data-[animate=true]:data-[side=bottom]:slide-in-from-top-1 motion-safe:data-[animate=true]:data-[side=top]:slide-in-from-bottom-1",
      )}
    >
      {state.items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No matching blocks</p>
      ) : (
        state.items.map((block, index) => (
          <div
            key={block.id}
            role="option"
            aria-selected={index === state.index}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => store.highlight(index)}
            onClick={() => store.choose(index)}
            className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm select-none aria-selected:bg-accent pointer-coarse:min-h-11"
          >
            <block.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {block.title}
          </div>
        ))
      )}
    </div>,
    store.element,
  );
}
