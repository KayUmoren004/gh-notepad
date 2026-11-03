import type { ShareFile, ShareStore } from "./store";

/** A share store in memory: for tests, and for running without Vercel Blob (development, end-to-end runs). */
export function createMemoryShareStore(): ShareStore {
  const copies = new Map<string, Map<string, ShareFile>>();
  const copy = (file: ShareFile): ShareFile => ({ ...file, bytes: new Uint8Array(file.bytes) });
  return {
    put: async (id, files) => {
      copies.set(id, new Map(files.map((file) => [file.path, copy(file)])));
    },
    get: async (id, path) => {
      const file = copies.get(id)?.get(path);
      return file ? copy(file) : null;
    },
    delete: async (id) => {
      copies.delete(id);
    },
  };
}
