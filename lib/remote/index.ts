/**
 * The remote: how the device reaches notebooks on GitHub. It calls the app's
 * own route handlers (`/api/notebooks/…`), never GitHub, so the token stays in
 * the server-side session.
 */
export {
  createRemote,
  RemoteError,
  type CommitResult,
  type Remote,
  type RemoteErrorKind,
  type RemoteOptions,
} from "./remote";
export type {
  ApiErrorBody,
  ApiErrorCode,
  AttachmentBlobResponse,
  BlobsRequest,
  BlobsResponse,
  CommitRequest,
  CommitResponse,
  FileChange,
  FilesResponse,
  HeadResponse,
  NotebookRef,
  RemoteFile,
} from "./contract";
export { BLOBS_PER_REQUEST } from "./contract";
