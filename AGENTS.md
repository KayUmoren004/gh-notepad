# Online Notepad App - Agent Guidelines

## Project Overview

This is a full-stack markdown notepad application with GitHub integration and offline-first capabilities. Users can write notes in markdown, organize them with folders and tags, upload images via Vercel Blob, and sync all data to their personal GitHub repository. The app works seamlessly online and offline.

## Key Features

- **Markdown Editor**: Rich markdown editing with live preview split-view
- **GitHub Sync**: Automatic synchronization to user's GitHub `my-notes` repository
- **Image Upload**: Image uploads via Vercel Blob storage with markdown embedding
- **Folders & Tags**: Hierarchical organization with folders and multiple tags per note
- **Offline Support**: Full offline functionality with automatic sync when online
- **GitHub OAuth**: Secure authentication using GitHub OAuth
- **Responsive Design**: Mobile-friendly interface built with Tailwind CSS and shadcn/ui

## Architecture

### Directory Structure

```
app/
├── page.tsx                 # Landing page
├── layout.tsx              # Root layout with auth provider
├── globals.css             # Tailwind theme and design tokens
├── api/
│   ├── auth/              # GitHub OAuth authentication routes
│   │   ├── login/route.ts
│   │   ├── callback/route.ts
│   │   ├── logout/route.ts
│   │   └── me/route.ts
│   ├── notes/             # Note CRUD operations
│   │   ├── route.ts       # GET, POST, DELETE all notes
│   │   └── [id]/route.ts  # PUT, DELETE specific note
│   └── upload/            # Image upload to Vercel Blob
│       └── route.ts
└── notes/
    └── page.tsx           # Notes editor and list view

components/
├── auth-provider.tsx      # Client context for auth state
├── markdown-editor.tsx    # Main editor with toolbar and preview
├── folder-tag-manager.tsx # UI for managing folders and tags
├── image-upload-dialog.tsx # Image upload dialog
├── sync-status.tsx        # Online/offline status indicator
└── ui/                    # shadcn/ui components

lib/
├── github-auth.ts         # GitHub OAuth utilities
├── github-notes.ts        # GitHub API integration for notes
├── offline-storage.ts     # LocalStorage and IndexedDB utilities
├── types.ts              # TypeScript interfaces
├── hooks/
│   └── use-notes.ts      # Hook for note state and sync
```

### Technology Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **UI**: React 19 with shadcn/ui components
- **Styling**: Tailwind CSS v4 with design tokens
- **Fonts**: Geist (sans) and Geist Mono
- **Icons**: lucide-react
- **Markdown**: react-markdown with remark plugins
- **Storage**:
  - Backend: GitHub API (files stored in user's repo)
  - Images: Vercel Blob
  - Offline: Browser localStorage
- **Authentication**: GitHub OAuth 2.0

## Environment Variables

Required variables (set in Vercel dashboard):

```
GITHUB_CLIENT_ID=your_github_oauth_app_id
GITHUB_CLIENT_SECRET=your_github_oauth_app_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000 (dev) or production URL
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

The `NEXT_PUBLIC_` prefix makes variables available in the browser for client-side code.

## Development

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create GitHub OAuth app and add credentials to `.env.local`
4. Run development server: `npm run dev`
5. Open http://localhost:3000

### Build & Deploy

```bash
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Code Style Guidelines

### TypeScript

- Use strict typing (`strict: true` in tsconfig.json)
- Create interfaces in `lib/types.ts` for shared types
- Avoid `any` types; use `unknown` with type guards instead

### React Components

- Use functional components with hooks
- Keep components under 400 lines; split into smaller components
- Use shadcn/ui components from `components/ui/`
- Apply Tailwind classes directly; avoid custom CSS when possible
- Use `cn()` utility (from `lib/utils.ts`) for conditional classes

### Tailwind CSS

- Use spacing scale: `p-4`, `m-2`, `gap-6` (avoid arbitrary values)
- Use semantic classes: `items-center`, `justify-between`, `text-center`
- Apply responsive prefixes: `md:grid-cols-2`, `lg:text-xl`
- Define design tokens in `app/globals.css` for reusable colors

## Design & Style Guidelines

### Visual Theme

- **Notion-like dark theme**: Clean, minimalist aesthetic with neutral dark backgrounds
- **Soft contrast**: Avoid harsh blacks; use warm grays and subtle borders
- **Minimal UI chrome**: Reduce visual clutter; let content breathe

### File Naming

- Components: kebab-case (e.g., `markdown-editor.tsx`)
- Utilities/Hooks: kebab-case (e.g., `use-notes.ts`)
- API routes: lowercase with hyphens (e.g., `/api/auth/callback`)

## Authentication Flow

1. User clicks "Sign in with GitHub" on landing page
2. Redirected to GitHub OAuth authorization screen
3. On callback, access token stored securely in HTTP-only cookie
4. Auth state managed via `AuthContext` in `auth-provider.tsx`
5. Protected routes check for valid session before rendering
6. Logout clears session cookie and resets auth state

## Data Storage

### Notes Structure (stored in GitHub)

Each note is stored as a JSON file in the `my-notes` repository:

```json
{
  "id": "note-uuid",
  "title": "Note Title",
  "content": "# Markdown content\nWith **formatting**",
  "folder": "folder-name",
  "tags": ["tag1", "tag2"],
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Offline Sync

- Notes synced to localStorage immediately on change
- Changes queued if offline (via `offline-storage.ts`)
- When online, sync queue processed automatically
- LastSyncTime tracked to avoid redundant syncs
- Conflict resolution: client version takes precedence

### Images

- Uploaded via `POST /api/upload` using Vercel Blob
- Returns URL for markdown embedding: `![alt](blob-url)`
- Images stored separately from notes for performance

## Security Considerations

- GitHub token stored in HTTP-only cookie; never exposed to client
- Never log or expose sensitive tokens
- Validate all GitHub API responses for errors
- Use GitHub's OAuth scope minimally (only `repo` access for notes)
- Sanitize markdown input to prevent XSS (via react-markdown)
- Validate file names and folder names on backend
- Rate limit GitHub API calls to stay within quota

## API Reference

### Authentication

- `GET /api/auth/login` - Redirect to GitHub OAuth
- `GET /api/auth/callback` - OAuth callback handler
- `POST /api/auth/logout` - Clear session and logout
- `GET /api/auth/me` - Get current user info

### Notes CRUD

- `GET /api/notes` - List all notes
- `POST /api/notes` - Create new note
- `PUT /api/notes/[id]` - Update note
- `DELETE /api/notes/[id]` - Delete note

### Images

- `POST /api/upload` - Upload image to Vercel Blob

## Common Tasks

### Adding a New Feature

1. Create new component in `components/` if needed
2. Add types to `lib/types.ts`
3. Implement in `app/notes/page.tsx` or new route
4. Update GitHub API integration if data storage changes
5. Test offline sync with DevTools network throttling

### Debugging

- Enable React DevTools for state inspection
- Use browser DevTools Network tab to inspect GitHub API calls
- Check localStorage: `localStorage.getItem('notes-cache')`
- Monitor sync status via `<SyncStatus />` indicator

### Updating GitHub API Integration

1. Modify `lib/github-notes.ts` for API logic
2. Update API routes in `app/api/notes/`
3. Add migration in sync logic if schema changes
4. Test with fresh GitHub token

## Known Limitations

- GitHub API rate limit: 60 requests/hour (unauthenticated), 5,000/hour (authenticated)
- Large notes (>1MB) may cause issues with GitHub API
- Images stored in Blob may incur storage costs at scale
- Concurrent edits not supported; last write wins

## Future Enhancements

- Real-time collaboration
- Rich text editor alternative to markdown
- Note sharing and permissions
- Backup to cloud storage
- Search across all notes
- Keyboard shortcuts for common actions
