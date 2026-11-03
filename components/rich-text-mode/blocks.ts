import type { ChainedCommands } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  Quote,
  SquareCode,
  Table,
  Type,
} from "lucide-react";

/** A block the slash menu can insert, turning the current block into it. */
export interface Block {
  id: string;
  title: string;
  /** Other words the menu matches, Markdown syntax among them. */
  keywords: string[];
  icon: LucideIcon;
  /** Applies the block to the chain; absent for blocks that need input first (images). */
  apply?: (chain: ChainedCommands) => ChainedCommands;
}

export const BLOCKS: Block[] = [
  { id: "text", title: "Text", keywords: ["paragraph", "plain"], icon: Type, apply: (c) => c.setParagraph() },
  { id: "heading-1", title: "Heading 1", keywords: ["h1", "title", "#"], icon: Heading1, apply: (c) => c.setHeading({ level: 1 }) },
  { id: "heading-2", title: "Heading 2", keywords: ["h2", "subtitle", "##"], icon: Heading2, apply: (c) => c.setHeading({ level: 2 }) },
  { id: "heading-3", title: "Heading 3", keywords: ["h3", "###"], icon: Heading3, apply: (c) => c.setHeading({ level: 3 }) },
  { id: "bullet-list", title: "Bulleted list", keywords: ["unordered", "ul", "-"], icon: List, apply: (c) => c.toggleBulletList() },
  { id: "numbered-list", title: "Numbered list", keywords: ["ordered", "ol", "1."], icon: ListOrdered, apply: (c) => c.toggleOrderedList() },
  { id: "task-list", title: "Task list", keywords: ["todo", "checkbox", "checklist", "[ ]"], icon: ListTodo, apply: (c) => c.toggleTaskList() },
  { id: "quote", title: "Quote", keywords: ["blockquote", ">"], icon: Quote, apply: (c) => c.toggleBlockquote() },
  { id: "code-block", title: "Code block", keywords: ["code", "snippet", "```"], icon: SquareCode, apply: (c) => c.toggleCodeBlock() },
  {
    id: "table",
    title: "Table",
    keywords: ["grid", "columns", "|"],
    icon: Table,
    apply: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  { id: "divider", title: "Divider", keywords: ["rule", "hr", "line", "---"], icon: Minus, apply: (c) => c.setHorizontalRule() },
  { id: "image", title: "Image", keywords: ["picture", "photo", "attachment"], icon: Image },
];

/** The blocks matching what was typed after `/`: title words first, then keywords. */
export function matchBlocks(blocks: Block[], query: string): Block[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return blocks;
  const byTitle = blocks.filter((block) => block.title.toLowerCase().split(" ").some((word) => word.startsWith(wanted)));
  const byKeyword = blocks.filter(
    (block) => !byTitle.includes(block) && block.keywords.some((keyword) => keyword.toLowerCase().startsWith(wanted)),
  );
  return [...byTitle, ...byKeyword];
}
