/**
 * The device store (ADR 0002): every note this device holds, in IndexedDB
 * (one database per GitHub account), mirrored in memory for the UI.
 *
 * - The UI reads `getState()` and re-renders through `subscribe`; it changes
 *   notes only through intent-level operations (`createNote`, `editBody`,
 *   `rename`), so every path follows the same rules.
 * - Writes change memory at once and reach IndexedDB in a short trailing
 *   write, flushed straight away when the tab is hidden or the page unloads.
 * - `sync` is the sync engine's side: records with their agreed versions, and
 *   applying pulls and pushes.
 */
export {
  openDeviceStore,
  personalNotebookId,
  type Account,
  type AgreedVersion,
  type DeviceState,
  type DeviceStore,
  type DeviceStoreOptions,
  type Note,
  type Notebook,
  type NotebookLocation,
  type PullChange,
  type SyncLedger,
  type SyncRecord,
} from "./store";
