import type { NextRequest } from "next/server";
import { isAttachmentPath } from "@/lib/attachments";
import { isShareId } from "@/lib/share";
import { shareStoreFromEnv } from "@/lib/share-store";

/**
 * An attachment of a shared note, from its published copy: `/s/<id>/attachments/<name>`.
 * Only attachments are served this way; the copy's other files are the page's business.
 * Sandboxed and never sniffed, so an SVG opened on its own can't run scripts against the app.
 */
export async function GET(_request: NextRequest, context: RouteContext<"/s/[id]/[...file]">) {
  const { id, file } = await context.params;
  const path = file.join("/");
  if (!isShareId(id) || !isAttachmentPath(path)) return new Response(null, { status: 404 });
  const stored = await shareStoreFromEnv().get(id, path);
  if (!stored) return new Response(null, { status: 404 });
  return new Response(stored.bytes, {
    headers: {
      "content-type": stored.contentType,
      "content-length": String(stored.bytes.byteLength),
      // Attachments are immutable by name; an hour bounds how long a revoked share's images linger in caches.
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "x-robots-tag": "noindex",
    },
  });
}
