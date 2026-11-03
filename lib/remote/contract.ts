/**
 * The wire contract between the client-side remote and the notebook route
 * handlers under `/api/notebooks/`. Both sides import these types; nothing in
 * it is GitHub's shape.
 */

/** Where a notebook lives: a repository and the branch the app reads and writes. */
export interface NotebookRef {
  owner: string;
  repo: string;
  branch: string;
}

/** A file in a notebook at some commit. Equal SHAs mean equal content. */
export interface RemoteFile {
  path: string;
  sha: string;
}

/**
 * One file written or deleted by a commit. Text goes inline; binary files
 * (attachments) are stored as blobs first and named by `sha`.
 */
export type FileChange =
  | { path: string; content: string }
  | { path: string; sha: string }
  | { path: string; delete: true };

/** The blob GitHub stored an attachment's bytes under, ready to name in a commit. */
export interface AttachmentBlobResponse {
  sha: string;
}

export interface HeadResponse {
  commit: string;
  /** False when the head is still the commit the device said it knew. */
  changed: boolean;
}

export interface FilesResponse {
  files: RemoteFile[];
}

export interface BlobsRequest {
  shas: string[];
}

export interface BlobsResponse {
  /** Text content by blob SHA. */
  blobs: Record<string, string>;
}

export interface CommitRequest {
  branch: string;
  /** The head commit the changes were made against. */
  base: string;
  message: string;
  changes: FileChange[];
}

export interface CommitResponse {
  commit: string;
  /** Blob SHA of each file written, by path. */
  blobs: Record<string, string>;
}

export type ApiErrorCode =
  | "signed_out"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "branch_moved"
  | "rate_limited"
  | "github_unavailable";

export interface ApiErrorBody {
  error: ApiErrorCode;
  message?: string;
  /** Seconds to wait, for `rate_limited`. */
  retryAfter?: number;
}

/** Blob SHAs per `blobs` request, keeping each response well under hosting body limits. */
export const BLOBS_PER_REQUEST = 50;

export const routes = {
  personalNotebook: "/api/notebooks/personal",
  notebook: ({ owner, repo }: { owner: string; repo: string }) =>
    `/api/notebooks/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
};
