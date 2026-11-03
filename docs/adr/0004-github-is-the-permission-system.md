# No database: GitHub is the permission system

The app keeps no database of its own. Who may sign in is the owner's `ALLOWED_GITHUB_USERS` list plus anyone the owner has invited to one of the owner's shared notebooks; who may read or edit a notebook is whoever GitHub says is a collaborator on that repository. We chose this so there is no server-side store to run, secure, or lose, and so a member's data and permissions stay in GitHub where they can see and change them.

## Considered options

- **Our own permissions database** (per-note sharing with specific people): rejected; it would be the only data the app owns outside GitHub.
- **GitHub App with fine-grained repo access**: rejected for now; the existing OAuth App keeps setup simple, at the cost of the broad `repo` scope.

## Consequences

- Sharing with edit rights is per notebook, never per note.
- GitHub gives every collaborator on a personal-account repository write access, so shared notebooks offer edit access only; read-only sharing is done with share links.
- Adding someone to `ALLOWED_GITHUB_USERS` takes a redeploy; inviting them to a shared notebook does not.
- A share link must be a published copy of the note (a snapshot under an unguessable id in Vercel Blob), because the app cannot read a private notebook without a signed-in member.
