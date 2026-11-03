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
 * - Attachments (ADR 0003) inserted on this device are stored here at once
 *   (`addAttachment`), shown from the device copy (`attachmentSrc`), and
 *   offered to sync until a push commits them.
 * - Device data is scoped per account: the database by GitHub id, and anything
 *   kept in localStorage under `deviceKey(login, name)`, so accounts sharing a
 *   browser never see each other's. `deleteDeviceData` removes all of it (what
 *   signing out with "Remove notes from this device" does); `unsyncedNotes`
 *   says what that would lose.
 */
export {
  clearDeviceKeys,
  deleteDeviceData,
  deviceKey,
  deviceKeyPrefix,
  openDeviceStore,
  unsyncedNotes,
  type DeviceDataOptions,
  type UnsyncedNote,
} from "./device-data";
export {
  personalNotebookId,
  type Account,
  type AgreedVersion,
  type DeviceState,
  type DeviceStore,
  type DeviceStoreOptions,
  type NewAttachment,
  type Note,
  type Notebook,
  type NotebookLocation,
  type PendingAttachment,
  type PullChange,
  type SyncLedger,
  type SyncRecord,
} from "./store";
