/** The public page of a share, relative to the app's origin. */
export function sharePath(id: string): string {
  return `/s/${id}`;
}

/** The share link as the member copies it. */
export function shareUrl(appUrl: URL | string, id: string): string {
  return new URL(sharePath(id), appUrl).toString();
}
