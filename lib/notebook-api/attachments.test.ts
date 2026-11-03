import { describe, expect, it } from "vitest";
import { createWorld, type Device, type World } from "@/test/devices";

const member = "octo-member";
const notebook = `/api/notebooks/${member}/my-notes`;

/** A tiny PNG: bytes that are not valid UTF-8, so a text round trip would corrupt them. */
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x01]);

/** Sends raw bytes to the attachments route, as the remote does. */
function storeBytes(world: World, bytes: Uint8Array, { type = "image/png", as }: { type?: string; as?: Device } = {}) {
  return world.callApi(`${notebook}/attachments`, {
    method: "POST",
    as,
    headers: { "content-type": type },
    body: bytes,
  });
}

/** Commits a note and an attachment (already stored as blob `sha`) in one commit; returns the commit SHA. */
async function commitWithAttachment(world: World, laptop: Device, path: string, sha: string): Promise<string> {
  const [{ sha: base }] = world.github.commits(member, "my-notes");
  const response = await world.callApi(`${notebook}/commits`, {
    method: "POST",
    as: laptop,
    body: {
      branch: "main",
      base,
      message: 'Update "Trip" and add 1 attachment',
      changes: [
        { path: "Trip.md", content: `![Beach](/${path})\n` },
        { path, sha },
      ],
    },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { commit: string }).commit;
}

describe("the attachments routes", () => {
  it("refuse to store bytes without a session, before asking GitHub anything", async () => {
    const world = createWorld();
    await (await world.signIn(member)).sync();
    const before = world.github.requests().length;

    const response = await storeBytes(world, png);

    expect(response.status).toBe(401);
    expect(world.github.requests().slice(before)).toEqual([]);
  });

  it("refuse bytes that aren't an image, or more than an attachment may hold, storing nothing", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const before = world.github.requests().length;

    const text = await storeBytes(world, new TextEncoder().encode("hello"), { type: "text/plain", as: laptop });
    const huge = await storeBytes(world, new Uint8Array(10 * 1024 * 1024 + 1), { as: laptop });

    expect(text.status).toBe(400);
    expect(await text.json()).toMatchObject({ error: "invalid", message: "Images only (JPEG, PNG, GIF, WebP, SVG)" });
    expect(huge.status).toBe(400);
    expect(await huge.json()).toMatchObject({ error: "invalid", message: "Images must be under 10 MB" });
    expect(world.github.requests().slice(before)).toEqual([]);
  });

  it("store bytes as a blob that a commit then names, byte for byte", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();

    const stored = await storeBytes(world, png, { as: laptop });
    expect(stored.status).toBe(201);
    const { sha } = (await stored.json()) as { sha: string };
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // Nothing is in the notebook until a commit names the blob.
    expect(world.github.fileBytes(member, "my-notes", "attachments/beach.png")).toBeUndefined();

    await commitWithAttachment(world, laptop, "attachments/beach.png", sha);

    expect([...(world.github.fileBytes(member, "my-notes", "attachments/beach.png") ?? [])]).toEqual([...png]);
    const [commit] = world.github.commits(member, "my-notes");
    expect(commit.files.map((file) => file.path).sort()).toEqual(["Trip.md", "attachments/beach.png"]);
  });

  it("refuse a commit naming a blob that doesn't exist", async () => {
    const world = createWorld();
    const laptop = await world.signIn(member);
    await laptop.sync();
    const [{ sha: base }] = world.github.commits(member, "my-notes");

    const response = await world.callApi(`${notebook}/commits`, {
      method: "POST",
      as: laptop,
      body: { branch: "main", base, message: "Add", changes: [{ path: "attachments/x.png", sha: "not a sha" }] },
    });

    expect(response.status).toBe(400);
    expect(Object.keys(world.github.files(member, "my-notes"))).toEqual(["README.md"]);
  });

  describe("serving an attachment", () => {
    async function notebookWithAttachment(): Promise<{ world: World; laptop: Device; sha: string }> {
      const world = createWorld();
      const laptop = await world.signIn(member);
      await laptop.sync();
      const { sha } = (await (await storeBytes(world, png, { as: laptop })).json()) as { sha: string };
      await commitWithAttachment(world, laptop, "attachments/beach.png", sha);
      return { world, laptop, sha };
    }

    it("streams the bytes with their image type, privately cacheable, revalidated by ETag", async () => {
      const { world, laptop, sha } = await notebookWithAttachment();

      const response = await world.callApi(`${notebook}/attachments/beach.png?branch=main`, { as: laptop });

      expect(response.status).toBe(200);
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...png]);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
      expect(response.headers.get("etag")).toBe(`"${sha}"`);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");

      const unchanged = await world.callApi(`${notebook}/attachments/beach.png?branch=main`, {
        as: laptop,
        headers: { "if-none-match": `"${sha}"` },
      });
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("etag")).toBe(`"${sha}"`);
    });

    it("can be cached for good when the request names the blob", async () => {
      const { world, laptop, sha } = await notebookWithAttachment();
      const before = world.github.requests().length;

      const response = await world.callApi(`${notebook}/attachments/beach.png?branch=main&sha=${sha}`, { as: laptop });

      expect(response.status).toBe(200);
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...png]);
      expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      // The blob is fetched directly: the branch isn't consulted.
      expect(world.github.requests().slice(before)).toHaveLength(1);
    });

    it("needs a session", async () => {
      const { world } = await notebookWithAttachment();
      const before = world.github.requests().length;

      const response = await world.callApi(`${notebook}/attachments/beach.png?branch=main`);

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(world.github.requests().slice(before)).toEqual([]);
    });

    it.each(["..%2FTrip.md", "Trip.md", "deeper%2Fbeach.png", ".hidden.png", "beach.exe"])(
      "refuses the name %s before it reaches GitHub",
      async (name) => {
        const { world, laptop } = await notebookWithAttachment();
        const before = world.github.requests().length;

        const response = await world.callApi(`${notebook}/attachments/${name}?branch=main`, { as: laptop });

        expect(response.status).toBe(400);
        expect(world.github.requests().slice(before)).toEqual([]);
      },
    );

    it("answers 404 for an attachment the notebook doesn't have", async () => {
      const { world, laptop } = await notebookWithAttachment();

      const response = await world.callApi(`${notebook}/attachments/missing.png?branch=main`, { as: laptop });

      expect(response.status).toBe(404);
    });

    it("sends an SVG sandboxed, so it can't run scripts if opened on its own", async () => {
      const world = createWorld();
      const laptop = await world.signIn(member);
      await laptop.sync();
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const stored = await storeBytes(world, svg, { type: "image/svg+xml", as: laptop });
      const { sha } = (await stored.json()) as { sha: string };
      await commitWithAttachment(world, laptop, "attachments/diagram.svg", sha);

      const response = await world.callApi(`${notebook}/attachments/diagram.svg?branch=main`, { as: laptop });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });
});
