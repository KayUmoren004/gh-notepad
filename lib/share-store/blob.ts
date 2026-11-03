import { BlobNotFoundError, del, get, list, put } from "@vercel/blob";
import type { ShareFile, ShareStore } from "./store";

/**
 * A share store on Vercel Blob. Every file is a private blob under
 * `shares/<id>/`, so nothing is reachable at a Blob URL: the app reads a copy
 * with its token and serves it from `/s/<id>`, and revoking deletes it for
 * good. Reads bypass the CDN cache, so a republished note shows at once.
 */
export function createBlobShareStore({ token }: { token: string }): ShareStore {
  const prefix = (id: string) => `shares/${id}/`;

  async function urlsUnder(id: string): Promise<string[]> {
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: prefix(id), token, cursor, limit: 1000 });
      urls.push(...page.blobs.map((blob) => blob.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return urls;
  }

  return {
    put: async (id, files) => {
      const written = new Set<string>();
      for (const file of files) {
        const pathname = prefix(id) + file.path;
        const stored = await put(pathname, Buffer.from(file.bytes), {
          access: "private",
          token,
          contentType: file.contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        written.add(stored.url);
      }
      const stale = (await urlsUnder(id)).filter((url) => !written.has(url));
      if (stale.length > 0) await del(stale, { token });
    },

    get: async (id, path) => {
      let result;
      try {
        result = await get(prefix(id) + path, { access: "private", token, useCache: false });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
      if (!result || result.statusCode !== 200) return null;
      return {
        path,
        contentType: result.blob.contentType,
        bytes: new Uint8Array(await new Response(result.stream).arrayBuffer()),
      };
    },

    delete: async (id) => {
      const urls = await urlsUnder(id);
      if (urls.length > 0) await del(urls, { token });
    },
  };
}
