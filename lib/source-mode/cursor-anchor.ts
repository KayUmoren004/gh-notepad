/**
 * Where the cursor is in one editing mode, expressed so the other mode can
 * put it near the same place: rich text mode's textblocks and source mode's
 * lines hold the same words, under different syntax.
 */
export interface CursorLocation {
  /** The text of every textblock (rich text mode) or line (source mode), in order. */
  blocks: string[];
  /** The index of the block the cursor is in. */
  block: number;
  /** The cursor's offset in that block's text. */
  offset: number;
}

/** The cursor as the words around it, which survive the change of syntax between the modes. */
export interface CursorAnchor {
  /** Up to `WINDOW` words either side of the cursor, in order. */
  words: string[];
  /** How many of `words` start before the cursor. */
  before: number;
  /** How far past the start of the last of those words the cursor is. */
  into: number;
  /** The cursor's block as a share of the note, 0 to 1: a tie-breaker, and the fallback when no words match. */
  position: number;
}

interface Word {
  text: string;
  start: number;
}

const WINDOW = 8;

/** Runs of letters and digits, in any script. */
function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ text: match[0], start: match.index }));
}

export function cursorAnchor({ blocks, block, offset }: CursorLocation): CursorAnchor {
  const words = wordsOf(blocks[block] ?? "");
  const before = words.filter((word) => word.start < offset).length;
  const from = Math.max(0, before - WINDOW);
  const window = words.slice(from, before + WINDOW);
  const last = words[before - 1];
  return {
    words: window.map((word) => word.text),
    before: before - from,
    into: last ? offset - last.start : 0,
    position: blocks.length > 1 ? block / (blocks.length - 1) : 0,
  };
}

/**
 * The anchor's words matched to a block's words, in order, maximising the
 * weight of the matched anchor words: those nearest the cursor count most.
 */
function align(anchor: string[], weights: number[], words: Word[]): { score: number; matched: Map<number, number> } {
  const rows = anchor.length + 1;
  const columns = words.length + 1;
  const best = new Float64Array(rows * columns);
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const skip = Math.max(best[(i - 1) * columns + j], best[i * columns + j - 1]);
      const pair = anchor[i - 1] === words[j - 1].text ? best[(i - 1) * columns + j - 1] + weights[i - 1] : 0;
      best[i * columns + j] = Math.max(skip, pair);
    }
  }
  const matched = new Map<number, number>();
  for (let i = anchor.length, j = words.length; i > 0 && j > 0; ) {
    const here = best[i * columns + j];
    if (anchor[i - 1] === words[j - 1].text && here === best[(i - 1) * columns + j - 1] + weights[i - 1]) {
      matched.set(i - 1, j - 1);
      i--;
      j--;
    } else if (here === best[(i - 1) * columns + j]) i--;
    else j--;
  }
  return { score: best[anchor.length * columns + words.length], matched };
}

/** The block and offset in `blocks` nearest to where `anchor` was taken. */
export function findAnchor(blocks: string[], anchor: CursorAnchor): { block: number; offset: number } {
  if (blocks.length === 0) return { block: 0, offset: 0 };
  const expected = anchor.position * (blocks.length - 1);
  const fallback = { block: Math.round(expected), offset: 0 };
  if (anchor.words.length === 0) return fallback;

  const weights = anchor.words.map((_word, index) => 1 / (1 + Math.abs(index - (anchor.before - 1 + 0.5))));
  let best: { score: number; block: number; words: Word[]; matched: Map<number, number> } | null = null;
  for (let block = 0; block < blocks.length; block++) {
    const words = wordsOf(blocks[block]);
    if (words.length === 0) continue;
    const { score, matched } = align(anchor.words, weights, words);
    if (score === 0) continue;
    const closer = best && score === best.score && Math.abs(block - expected) < Math.abs(best.block - expected);
    if (!best || score > best.score || closer) best = { score, block, words, matched };
  }
  if (!best) return fallback;

  const { block, words, matched } = best;
  const text = blocks[block];
  let lastBefore = -1;
  let firstAfter = -1;
  for (const index of matched.keys()) {
    if (index < anchor.before) lastBefore = Math.max(lastBefore, index);
    else firstAfter = firstAfter === -1 ? index : Math.min(firstAfter, index);
  }
  if (lastBefore !== -1) {
    const word = words[matched.get(lastBefore) as number];
    const into = lastBefore === anchor.before - 1 ? anchor.into : word.text.length;
    return { block, offset: Math.min(word.start + into, text.length) };
  }
  if (firstAfter !== -1) return { block, offset: words[matched.get(firstAfter) as number].start };
  return { block, offset: 0 };
}
