# gh-notepad

An invite-only notepad whose notes live as Markdown files in GitHub repositories the user owns or is invited to, usable offline on any device.

## People

**Owner**:
The person who runs this deployment of the app and decides who may sign in.
_Avoid_: Admin

**Member**:
A GitHub user allowed to sign in to this deployment.
_Avoid_: User (ambiguous), guest, account

**Collaborator**:
A member invited to a shared notebook, with either view or edit rights to it.
_Avoid_: Member (membership is about signing in, not about a notebook)

## Notes and their organisation

**Note**:
One document a member writes, stored as a single Markdown file whose name is the note's title.
_Avoid_: Page, doc, file (when talking to members)

**Notebook**:
A GitHub repository of notes and attachments that the app shows in the sidebar.
_Avoid_: Workspace, repo (when talking to members), notes repo

**Personal notebook**:
A member's own private notebook, the `my-notes` repository in their GitHub account.
_Avoid_: My notes, home

**Shared notebook**:
A notebook that its collaborators can all open in the app.
_Avoid_: Team space, shared folder

**Folder**:
A named group of notes inside a notebook, stored as a directory; folders can contain folders.
_Avoid_: Category, collection

**Tag**:
A label attached to a note, used to find notes across folders and notebooks.
_Avoid_: Label, keyword

**Attachment**:
An image stored in a notebook and embedded in a note.
_Avoid_: Upload, blob, asset

**Trash**:
Where deleted notes and folders wait, restorable, until they are permanently deleted.
_Avoid_: Bin, archive

## Editing

**Rich text mode**:
Editing a note with formatting shown as it will look, limited to what Markdown can express.
_Avoid_: WYSIWYG, visual mode

**Source mode**:
Editing a note's raw Markdown.
_Avoid_: Raw mode, code view, markdown mode

**Version**:
One entry in a note's history: the note as it stood at the end of an editing session.
_Avoid_: Revision, snapshot, commit (when talking to members)

## Saving and syncing

**Saved**:
A note's latest edits are stored on this device and survive a reload or going offline.
_Avoid_: Cached, stored locally

**Synced**:
This device's version of a note matches the version in its notebook on GitHub.
_Avoid_: Uploaded, pushed, backed up

**Sync**:
The background process that brings this device and its notebooks into agreement.
_Avoid_: Autosave (autosave is **Saved**, not **Sync**)

**Conflict**:
A note that changed both on this device and in its notebook since they last agreed.
_Avoid_: Collision, clash

**Conflict copy**:
A separate note holding the notebook's version of a conflicting note, created when the two versions could not be merged automatically.
_Avoid_: Duplicate, backup

## Sharing

**Share link**:
A read-only public URL for one note that anyone holding it can view without signing in.
_Avoid_: Public note, published note
