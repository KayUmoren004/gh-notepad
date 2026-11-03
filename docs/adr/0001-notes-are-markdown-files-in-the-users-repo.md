# Notes are Markdown files in the user's GitHub repo

Each note is a plain `.md` file with YAML frontmatter (id, tags, timestamps) in the user's private notes repo; folders are real directories, and folder and tag lists are derived from the files rather than kept in a separate `metadata.json`. We chose this over v1's JSON blobs so notes stay readable and editable on github.com, in any editor, or in tools like Obsidian, and so the user owns their data in a format that outlives this app.

## Consequences

- The rich-text editor must round-trip GitHub-Flavored Markdown; formatting Markdown cannot express (text colour, underline, fonts) is not offered.
- Renaming or moving a note is a file move, so multi-file changes must be committed atomically.
- v1 data (`notes/*.json` + `metadata.json`) is migrated once, automatically, when found.
