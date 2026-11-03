# Attachments live in the notes repo, not Vercel Blob

Images are committed to an `attachments/` directory in the user's private notes repo and served to the app through an authenticated route, replacing v1's Vercel Blob uploads. v1's Blob URLs were public, so anyone with a link could see images from a private notes repo, and the images lived outside the data the user owns.

## Consequences

- The repo grows with every image; attachments are capped (about 10 MB each).
- Rendering an attachment needs the user's session, so share links must carry their own copy of any images they show.
