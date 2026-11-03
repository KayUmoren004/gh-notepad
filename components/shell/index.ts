/**
 * The app shell: the sidebar with the notebook tree, the note's top bar with
 * its breadcrumb, the phone's push/pop note screen, and the note URL.
 *
 * - `/notes/<id>` names the open note by id (`useNoteRoute`); opening a note
 *   is a history entry made with pushState, so the device store stays open
 *   and nothing is fetched.
 * - Desktop (`DESKTOP`): the sidebar beside a centred editor, collapsible and
 *   remembered per device (`SidebarProvider`). Phone: the sidebar is the home
 *   screen and `NoteScreen` pushes the note over it.
 * - The tree is virtualised, so notebooks with thousands of notes scroll smoothly.
 * - Folders: "New folder" (`NewFolderDialog`), inline renames, and moving by
 *   drag and drop on desktop (`tree-drag.ts`) or the Move to… sheet
 *   (`MoveToSheet`), with the row menu (`tree-row-menu.tsx`) offering all of
 *   it on a right click or the row's "…".
 * - Motion: tap-initiated pushes and the sidebar's collapse use the motion
 *   tokens; keyboard actions (`useShortcuts`) never animate.
 */
export { Breadcrumb } from "./breadcrumb";
export { NewFolderAction, NewFolderDialog, type FolderPlace, type NewFolderDialogProps } from "./folder-dialogs";
export { DESKTOP, useMediaQuery } from "./media";
export { MoveToSheet, type MoveToSheetProps } from "./move-to-sheet";
export { noteIdOfPath, pathOfNote, useNoteRoute, type NoteRoute } from "./note-route";
export { NoteScreen, type NoteScreenProps, type ScreenPhase } from "./note-screen";
export { useShortcuts } from "./shortcuts";
export { Sidebar, type SidebarProps } from "./sidebar";
export { SidebarProvider, useOptionalSidebar, useSidebar, type SidebarState } from "./sidebar-state";
export { TopBar, type TopBarProps } from "./top-bar";
