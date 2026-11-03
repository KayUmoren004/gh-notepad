import {
  BLOBS_PER_REQUEST,
  routes,
  type ApiErrorBody,
  type AttachmentBlobResponse,
  type BlobsResponse,
  type CommitResponse,
  type FileChange,
  type FilesResponse,
  type HeadResponse,
  type NotebookRef,
  type RemoteFile,
  type RevokeShareResponse,
  type ShareResponse,
} from "./contract";

/**
 * Why a remote call failed, in the terms sync acts on:
 * - `offline`: the app's server couldn't be reached; try again on reconnect.
 * - `signed-out`: the session ended or GitHub revoked the token; sign in again.
 * - `rate-limited`: GitHub asked us to wait `retryAfterMs`.
 * - `failed`: anything else; retry with back-off.
 */
export type RemoteErrorKind = "offline" | "signed-out" | "rate-limited" | "failed";

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export type CommitResult =
  | { status: "committed"; commit: string; blobs: Record<string, string> }
  /** Someone else committed first; nothing was written. */
  | { status: "branch-moved" };

/** The device's view of notebooks on GitHub, through the app's own routes. */
export interface Remote {
  /** The signed-in member's personal notebook, created on GitHub if it doesn't exist yet. */
  personalNotebook: () => Promise<NotebookRef>;
  /** The notebook's head commit; `changed` is false when it is still `known` (which costs GitHub nothing). */
  head: (notebook: NotebookRef, known: string | null) => Promise<HeadResponse>;
  /** Every file in the notebook at `commit`. */
  files: (notebook: NotebookRef, commit: string) => Promise<RemoteFile[]>;
  /** Text content of blobs, by SHA, fetched in batches. */
  blobs: (notebook: NotebookRef, shas: readonly string[]) => Promise<Map<string, string>>;
  /** One atomic commit of every change on top of `base`. */
  commit: (
    notebook: NotebookRef,
    commit: { base: string; message: string; changes: FileChange[] },
  ) => Promise<CommitResult>;
  /** Stores an attachment's bytes on GitHub as a blob, to name in a later commit; returns its SHA. */
  storeAttachment: (notebook: NotebookRef, attachment: { type: string; bytes: Blob }) => Promise<string>;
  /** Publishes, or republishes, the share link copy of the note at `path` as it stands at the notebook's head. */
  publishShare: (notebook: NotebookRef, path: string) => Promise<ShareResponse>;
  /** Removes the published copy under share id `id`. */
  revokeShare: (notebook: NotebookRef, id: string) => Promise<void>;
}

export interface RemoteOptions {
  /** The app's origin; relative URLs (the default `""`) suit the browser. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createRemote({ baseUrl = "", fetch: send = (...args) => fetch(...args) }: RemoteOptions = {}): Remote {
  async function call<T>(
    path: string,
    init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; bytes?: { type: string; blob: Blob } } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await send(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: init.bytes
          ? { "content-type": init.bytes.type }
          : init.body === undefined
            ? {}
            : { "content-type": "application/json" },
        body: init.bytes ? init.bytes.blob : init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (error) {
      throw new RemoteError("offline", error instanceof Error ? error.message : "The network is unavailable");
    }
    if (response.ok) return (await response.json()) as T;
    throw await failure(response);
  }

  return {
    personalNotebook: () => call<NotebookRef>(routes.personalNotebook, { method: "POST" }),

    head: (notebook, known) => {
      const query = new URLSearchParams({ branch: notebook.branch });
      if (known) query.set("known", known);
      return call<HeadResponse>(`${routes.notebook(notebook)}/head?${query}`);
    },

    files: async (notebook, commit) =>
      (await call<FilesResponse>(`${routes.notebook(notebook)}/files?${new URLSearchParams({ commit })}`)).files,

    blobs: async (notebook, shas) => {
      const unique = [...new Set(shas)];
      const contents = new Map<string, string>();
      for (let start = 0; start < unique.length; start += BLOBS_PER_REQUEST) {
        const batch = unique.slice(start, start + BLOBS_PER_REQUEST);
        const { blobs } = await call<BlobsResponse>(`${routes.notebook(notebook)}/blobs`, {
          method: "POST",
          body: { shas: batch },
        });
        for (const sha of batch) {
          if (typeof blobs[sha] !== "string") throw new RemoteError("failed", `Blob ${sha} was not returned`);
          contents.set(sha, blobs[sha]);
        }
      }
      return contents;
    },

    commit: async (notebook, { base, message, changes }) => {
      try {
        const result = await call<CommitResponse>(`${routes.notebook(notebook)}/commits`, {
          method: "POST",
          body: { branch: notebook.branch, base, message, changes },
        });
        return { status: "committed", commit: result.commit, blobs: result.blobs };
      } catch (error) {
        if (error instanceof BranchMoved) return { status: "branch-moved" };
        throw error;
      }
    },

    storeAttachment: async (notebook, { type, bytes }) =>
      (
        await call<AttachmentBlobResponse>(`${routes.notebook(notebook)}/attachments`, {
          method: "POST",
          bytes: { type, blob: bytes },
        })
      ).sha,

    publishShare: (notebook, path) =>
      call<ShareResponse>(`${routes.notebook(notebook)}/share`, {
        method: "POST",
        body: { branch: notebook.branch, path },
      }),

    revokeShare: async (notebook, id) => {
      await call<RevokeShareResponse>(`${routes.notebook(notebook)}/share`, { method: "DELETE", body: { id } });
    },
  };
}

class BranchMoved extends Error {}

async function failure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>;
  const message = body.message ?? `The notebook service answered ${response.status}`;
  switch (body.error) {
    case "branch_moved":
      return new BranchMoved(message);
    case "signed_out":
      return new RemoteError("signed-out", message);
    case "rate_limited":
      return new RemoteError("rate-limited", message, (body.retryAfter ?? 60) * 1000);
    default:
      return new RemoteError(response.status === 401 ? "signed-out" : "failed", message);
  }
}
