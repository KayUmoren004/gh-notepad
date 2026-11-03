# Local-first: save to the device, sync to GitHub in the background

Every edit is written to the device (IndexedDB) immediately, and the UI reads only from the device; a separate background sync reconciles the device with each notebook on GitHub (after a short idle, on note switch, on tab hide, on reconnect), one sync at a time, covering every changed note. This replaces v1's debounce-then-queue design, which lost new notes, sent stale SHAs, and overwrote in-progress typing with server copies.

## Consequences

- "Saved" (on this device) and "Synced" (matches GitHub) are distinct states the UI shows separately.
- Conflicts are detected against the last version both sides agreed on; non-overlapping edits merge automatically, overlapping ones keep the device's version and create a conflict copy. Data is never silently dropped.
