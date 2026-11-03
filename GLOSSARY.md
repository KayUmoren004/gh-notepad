# gh-notepad

A notepad whose notes live as Markdown files in the user's own GitHub repository, usable offline on any device.

## Notes and their organisation

**Note**:
One document the user writes, stored as a single Markdown file.
_Avoid_: Page, doc, file (when talking to users)

**Notes repo**:
The user's private GitHub repository (`my-notes`) that holds their notes and attachments.
_Avoid_: Backend, database, storage

**Folder**:
A named group of notes, stored as a directory in the notes repo.
_Avoid_: Category, collection

**Tag**:
A label attached to a note, used to find notes across folders.
_Avoid_: Label, keyword

**Attachment**:
An image stored in the notes repo and embedded in a note.
_Avoid_: Upload, blob, asset

## Saving and syncing

**Saved**:
A note's latest edits are stored on this device and survive a reload or going offline.
_Avoid_: Cached, stored locally

**Synced**:
This device's version of a note matches the version in the notes repo.
_Avoid_: Uploaded, pushed, backed up

**Sync**:
The background process that brings this device and the notes repo into agreement.
_Avoid_: Autosave (autosave is **Saved**, not **Sync**)

**Conflict**:
A note that changed both on this device and in the notes repo since they last agreed.
_Avoid_: Collision, clash

**Conflict copy**:
A separate note holding the notes repo's version of a conflicting note, created when the two versions could not be merged automatically.
_Avoid_: Duplicate, backup
