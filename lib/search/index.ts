/**
 * Full-text search over every note on the device, on the device: nothing here
 * touches the network, so searching works offline.
 *
 * - `createNoteIndex` wraps MiniSearch over a note's title, body, tags and
 *   folder. `update(notes)` takes the device store's notes map and re-indexes
 *   only the notes whose object changed (the store keeps unchanged notes'
 *   identity), so following the store costs a map walk; building from scratch
 *   on load takes tens of milliseconds for a thousand notes.
 * - `search` lists title matches first (by prefix, tolerating a typo), then
 *   matches in the text, tags or folder, every word of the query required.
 *   Each result carries the title and a snippet with the matched words marked
 *   (`Segment`s), and the note's path: notebook name, then folders.
 * - `highlight`, `snippetOf` and `shortPath` are the pure pieces: the marked
 *   segments of a text, the first matching line of a body with its Markdown
 *   markers removed and long lines cut to a window around the match, and a
 *   deep path shortened to its end.
 */
export { createNoteIndex, type NoteIndex, type SearchResult, type SearchableNote } from "./note-index";
export { highlight, shortPath, snippetOf, tagSegments, type Segment } from "./snippet";
