/**
 * Tags: labels on notes, used to find notes across folders and notebooks.
 * Pure functions over the device store's notes, with no idea of React or the
 * DOM; the tag itself lives in each note's frontmatter (`lib/notebook-format`).
 *
 * - A tag is matched without regard to case (`tagKey`) and shown in the casing
 *   first used (`indexTags`, `canonicalTags`).
 * - `indexTags` lists every tag across notebooks with the notes carrying it;
 *   `filterByTags` keeps the notes that carry every selected tag.
 */
export {
  canonicalTags,
  cleanTags,
  filterByTags,
  indexTags,
  normalizeTag,
  tagKey,
  type TagEntry,
  type TagIndex,
  type TaggedNote,
} from "./tags";
