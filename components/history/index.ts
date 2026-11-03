/**
 * A note's History panel: the versions of its file in the notebook, grouped
 * by editing session, each previewable (read-only rich text), comparable with
 * the note as it is now (a line diff), and restorable, which makes it the
 * note's text again and syncs as a new version. Desktop: a side panel beside
 * the editor; phone: a full-screen sheet. History needs a connection; offline
 * the panel says so, and the versions this device has cached stay browsable.
 * The command palette opens it with a `notepad:open-history` event on `window`.
 */
export { HistoryButton } from "./history-button";
export { HistoryPanel, type HistoryPanelProps } from "./history-panel";
export { OPEN_HISTORY_EVENT, useHistoryPanel, type HistoryPanelState } from "./use-history-panel";
