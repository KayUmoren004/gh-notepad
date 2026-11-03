/**
 * The remote: how the device reaches notebooks on GitHub. It calls the app's
 * own route handlers (`/api/notebooks/…`, `/api/invitations/…`), never GitHub,
 * so the token stays in the server-side session. Besides the sync calls it
 * carries the shared-notebook ones: listing and creating notebooks,
 * collaborators, invitations and leaving.
 */
export {
  createRemote,
  RemoteError,
  type Collaborator,
  type CommitResult,
  type InviteResponse,
  type NotebookInvitation,
  type NotebookRepository,
  type Remote,
  type RemoteErrorKind,
  type RemoteNotebook,
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
