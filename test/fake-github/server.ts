import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakeGitHub, type FakeGitHub } from "./fake-github";

export interface FakeGitHubServer {
  /** e.g. `http://localhost:4010`; point the app's GitHub base URLs here. */
  url: string;
  /** The in-process fake behind the server, for seeding from the same process. */
  fake: FakeGitHub;
  close: () => Promise<void>;
}

/** Serves a fake GitHub over HTTP. `port: 0` picks a free port. */
export async function startFakeGitHubServer(
  options: { port?: number; fake?: FakeGitHub } = {},
): Promise<FakeGitHubServer> {
  const fake = options.fake ?? createFakeGitHub();
  const server = createServer((request, response) => void serve(fake, request, response));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    fake,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Adapts Node's request/response to the fake's `Request` → `Response` handler. */
async function serve(fake: FakeGitHub, incoming: IncomingMessage, outgoing: ServerResponse) {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const method = incoming.method ?? "GET";

    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }

    const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`);
    const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
    const response = await fake.handle(new Request(url, { method, headers, body }));

    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") outgoing.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(error instanceof Error ? error.stack : String(error));
  }
}
