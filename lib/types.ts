// User types
export interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

// Note types
export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteWithMeta extends Note {
  sha?: string; // GitHub file SHA for updates
}

// Folder and Tag types
export interface Folder {
  id: string;
  name: string;
  noteCount: number;
}

export interface Tag {
  name: string;
  color: string;
}

export interface Metadata {
  folders: string[];
  tags: Tag[];
}

// Sync types
export type SyncActionType = "create" | "update" | "delete";

export interface SyncAction {
  id: string;
  type: SyncActionType;
  noteId: string;
  note?: Note;
  timestamp: string;
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingChanges: number;
}

// API response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

// GitHub API types
export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir";
  content?: string;
  encoding?: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
}

// Auth context types
export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
