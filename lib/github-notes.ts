import type {
  Note,
  NoteWithMeta,
  GitHubFile,
  GitHubRepo,
  Metadata,
} from "./types";

const REPO_NAME = "gh-notepad";
const NOTES_DIR = "notes";
const METADATA_FILE = "metadata.json";

// GitHub API base URL
const GITHUB_API = "https://api.github.com";

// Helper to make authenticated GitHub API requests
async function githubFetch(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${GITHUB_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// Get the authenticated user's login
async function getUsername(token: string): Promise<string> {
  const response = await githubFetch(token, "/user");
  if (!response.ok) {
    throw new Error("Failed to get user info");
  }
  const user = await response.json();
  return user.login;
}

// Check if the notes repository exists
export async function checkRepoExists(token: string): Promise<boolean> {
  const username = await getUsername(token);
  const response = await githubFetch(token, `/repos/${username}/${REPO_NAME}`);
  return response.ok;
}

// Create the notes repository
export async function createNotesRepo(token: string): Promise<GitHubRepo> {
  const response = await githubFetch(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: REPO_NAME,
      description: "My personal notes stored via gh-notepad",
      private: true,
      auto_init: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create repository: ${error.message}`);
  }

  const repo = await response.json();

  // Create initial metadata file
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for repo to initialize
  await saveMetadata(token, { folders: [], tags: [] });

  return repo;
}

// Ensure the repository exists, create if not
export async function ensureRepoExists(token: string): Promise<void> {
  const exists = await checkRepoExists(token);
  if (!exists) {
    await createNotesRepo(token);
  }
}

// Get file content from the repository
async function getFileContent(
  token: string,
  path: string
): Promise<{ content: string; sha: string } | null> {
  const username = await getUsername(token);
  const response = await githubFetch(
    token,
    `/repos/${username}/${REPO_NAME}/contents/${path}`
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to get file: ${path}`);
  }

  const file: GitHubFile = await response.json();
  if (file.content && file.encoding === "base64") {
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    return { content, sha: file.sha };
  }

  return null;
}

// Create or update a file in the repository
async function saveFile(
  token: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
  const username = await getUsername(token);
  const encodedContent = Buffer.from(content).toString("base64");

  const body: Record<string, string> = {
    message,
    content: encodedContent,
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await githubFetch(
    token,
    `/repos/${username}/${REPO_NAME}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to save file: ${error.message}`);
  }

  const result = await response.json();
  return result.content.sha;
}

// Delete a file from the repository
async function deleteFile(
  token: string,
  path: string,
  sha: string,
  message: string
): Promise<void> {
  const username = await getUsername(token);

  const response = await githubFetch(
    token,
    `/repos/${username}/${REPO_NAME}/contents/${path}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

// List all files in the notes directory
async function listNotesFiles(token: string): Promise<GitHubFile[]> {
  const username = await getUsername(token);
  const response = await githubFetch(
    token,
    `/repos/${username}/${REPO_NAME}/contents/${NOTES_DIR}`
  );

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error("Failed to list notes");
  }

  const files: GitHubFile[] = await response.json();
  return files.filter((f) => f.type === "file" && f.name.endsWith(".json"));
}

// Get all notes
export async function getAllNotes(token: string): Promise<NoteWithMeta[]> {
  await ensureRepoExists(token);

  const files = await listNotesFiles(token);
  const notes: NoteWithMeta[] = [];

  for (const file of files) {
    const result = await getFileContent(token, file.path);
    if (result) {
      try {
        const note = JSON.parse(result.content) as Note;
        notes.push({ ...note, sha: result.sha });
      } catch (e) {
        console.error(`Failed to parse note: ${file.name}`, e);
      }
    }
  }

  // Sort by updatedAt descending
  return notes.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

// Get a single note by ID
export async function getNoteById(
  token: string,
  id: string
): Promise<NoteWithMeta | null> {
  const path = `${NOTES_DIR}/${id}.json`;
  const result = await getFileContent(token, path);

  if (!result) {
    return null;
  }

  try {
    const note = JSON.parse(result.content) as Note;
    return { ...note, sha: result.sha };
  } catch {
    return null;
  }
}

// Create a new note
export async function createNote(
  token: string,
  note: Omit<Note, "id" | "createdAt" | "updatedAt">
): Promise<NoteWithMeta> {
  await ensureRepoExists(token);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const newNote: Note = {
    ...note,
    id,
    createdAt: now,
    updatedAt: now,
  };

  const path = `${NOTES_DIR}/${id}.json`;
  const content = JSON.stringify(newNote, null, 2);
  const sha = await saveFile(
    token,
    path,
    content,
    `Create note: ${newNote.title}`
  );

  return { ...newNote, sha };
}

// Update an existing note
export async function updateNote(
  token: string,
  id: string,
  updates: Partial<Omit<Note, "id" | "createdAt">>,
  currentSha: string
): Promise<NoteWithMeta> {
  const existing = await getNoteById(token, id);

  if (!existing) {
    throw new Error("Note not found");
  }

  const updatedNote: Note = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const path = `${NOTES_DIR}/${id}.json`;
  const content = JSON.stringify(updatedNote, null, 2);
  const sha = await saveFile(
    token,
    path,
    content,
    `Update note: ${updatedNote.title}`,
    currentSha
  );

  return { ...updatedNote, sha };
}

// Delete a note
export async function deleteNote(
  token: string,
  id: string,
  sha: string
): Promise<void> {
  const path = `${NOTES_DIR}/${id}.json`;
  await deleteFile(token, path, sha, `Delete note: ${id}`);
}

// Get metadata (folders and tags)
export async function getMetadata(token: string): Promise<Metadata> {
  const result = await getFileContent(token, METADATA_FILE);

  if (!result) {
    return { folders: [], tags: [] };
  }

  try {
    return JSON.parse(result.content) as Metadata;
  } catch {
    return { folders: [], tags: [] };
  }
}

// Save metadata
export async function saveMetadata(
  token: string,
  metadata: Metadata
): Promise<void> {
  const existing = await getFileContent(token, METADATA_FILE);
  const content = JSON.stringify(metadata, null, 2);

  await saveFile(
    token,
    METADATA_FILE,
    content,
    "Update metadata",
    existing?.sha
  );
}

// Add a folder
export async function addFolder(
  token: string,
  folderName: string
): Promise<void> {
  const metadata = await getMetadata(token);

  if (!metadata.folders.includes(folderName)) {
    metadata.folders.push(folderName);
    await saveMetadata(token, metadata);
  }
}

// Remove a folder
export async function removeFolder(
  token: string,
  folderName: string
): Promise<void> {
  const metadata = await getMetadata(token);
  metadata.folders = metadata.folders.filter((f) => f !== folderName);
  await saveMetadata(token, metadata);
}

// Add a tag
export async function addTag(
  token: string,
  tag: { name: string; color: string }
): Promise<void> {
  const metadata = await getMetadata(token);

  if (!metadata.tags.some((t) => t.name === tag.name)) {
    metadata.tags.push(tag);
    await saveMetadata(token, metadata);
  }
}

// Remove a tag
export async function removeTag(token: string, tagName: string): Promise<void> {
  const metadata = await getMetadata(token);
  metadata.tags = metadata.tags.filter((t) => t.name !== tagName);
  await saveMetadata(token, metadata);
}
