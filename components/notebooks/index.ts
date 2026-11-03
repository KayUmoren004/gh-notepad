/**
 * Shared notebooks in the shell (ADR 0004): creating one, who can open it,
 * invitations, and leaving.
 *
 * - `NewNotebookButton` by the sidebar's Notebooks heading opens
 *   `NewNotebookDialog`, and lists the same action in the command palette
 *   while mounted. The dialog previews the repository the typed name becomes
 *   (`notebook-name.ts`) and creates it through the routes.
 * - `NotebookRowMenu` is the "…" on a notebook's row in the tree: a new note
 *   in that notebook, `NotebookSettingsDialog` (collaborators, invitations,
 *   inviting by GitHub username) for a shared one, and `LeaveNotebookDialog`
 *   for a collaborator, which also forgets the notebook on the device.
 * - `InvitationsBanner` shows the invitations waiting for the member, with
 *   Accept; sync then brings the notebook onto the device.
 *
 * Everything reaches GitHub through the remote, and keeps the device store in
 * step the way sync would (`forgetNotebook`, `refreshNotebooks`).
 */
export { InvitationsBanner } from "./invitations-banner";
export { LeaveNotebookDialog } from "./leave-notebook-dialog";
export { NewNotebookButton, NewNotebookDialog } from "./new-notebook-dialog";
export { checkNotebookName, notebookSlug, usernameToInvite, type NotebookNameCheck } from "./notebook-name";
export { NotebookRowMenu } from "./notebook-row-menu";
export { NotebookSettingsDialog } from "./notebook-settings-dialog";
