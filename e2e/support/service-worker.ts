import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page } from "@playwright/test";
import { appUrl } from "./env";

/** Installing the worker precaches the whole build, which takes a while under parallel load. */
export const installTimeout = { timeout: 15_000 };

/** Resolves once the service worker sees this tab's requests. */
export async function waitUntilControlled(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), installTimeout).toBe(true);
}

/**
 * Resolves once the service worker has stored the page this tab is showing.
 * Under `/notes`, that is the app shell: a note's own URL is reached without a
 * page load, and offline the worker answers it with the `/notes` shell.
 */
export async function waitUntilAvailableOffline(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const shell = location.pathname.startsWith("/notes") ? new URL("/notes", location.href).href : location.href;
          return !!(await caches.match(shell));
        }),
      installTimeout,
    )
    .toBe(true);
}

/**
 * The app under test behind a pass-through proxy on a port of its own, standing in
 * for a site that gets redeployed: after `deployNewVersion()` it serves a changed
 * service worker script, as a new build would. (Playwright can't route the browser's
 * own fetch of the worker script.) Its own origin keeps its worker apart from other tests'.
 */
export interface Deployment {
  url: string;
  deployNewVersion: () => void;
  close: () => Promise<void>;
}

/** Hop-by-hop headers, and the encoding `fetch` has already undone. */
const unforwarded = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

export async function startDeployment(): Promise<Deployment> {
  let version = 1;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", appUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !unforwarded.has(name)) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    let body = Buffer.from(await upstream.arrayBuffer());
    if (url.pathname === "/serwist/sw.js") body = Buffer.concat([body, Buffer.from(`\n// Deployment ${version}\n`)]);

    const responseHeaders: Record<string, string | string[]> = {};
    upstream.headers.forEach((value, name) => {
      if (!unforwarded.has(name) && name !== "set-cookie") responseHeaders[name] = value;
    });
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) responseHeaders["set-cookie"] = cookies;
    response.writeHead(upstream.status, responseHeaders);
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    deployNewVersion: () => {
      version += 1;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
