import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { NextRequest } from "next/server";
import { authFromEnv } from "@/lib/auth";
import { openDeviceStore, type DeviceStore } from "@/lib/device-store";
import { notebookApiFromEnv } from "@/lib/notebook-api";
import { createRemote } from "@/lib/remote";
import { createSyncEngine, type SyncEngine, type SyncEngineOptions } from "@/lib/sync-engine";
import { CookieJar } from "./cookie-jar";
import { createFakeGitHub, type FakeGitHub } from "./fake-github";

/**
 * The whole sync path in one process, for sync engine tests: devices (each its
 * own IndexedDB and cookies) running the real device store, sync engine and
 * remote, calling the real notebook routes, which call the real gateway, which
 * calls the fake GitHub.
 */

const appUrl = "https://notes.example";

/** One browser signed in as a member: the app's client side as it runs on that device. */
export interface Device {
  login: string;
  /** The browser's IndexedDB, shared by every account signed in on it. */
  indexedDB: IDBFactory;
  cookies: CookieJar;
  store: DeviceStore;
  engine: SyncEngine;
  /** Runs a sync to completion (joining one already running, and its follow-up). */
  sync: () => Promise<void>;
  /** Closes the app and opens it again on the same device: same IndexedDB, same cookies. */
  reopen: () => Promise<Device>;
}

/** A request on its way to GitHub, held until the test lets it through. */
export interface Hold {
  /** Resolves when a matching request reaches the hold. */
  reached: Promise<void>;
  release: () => void;
}

export interface SignInOptions extends Pick<SyncEngineOptions, "timers"> {
  sameBrowserAs?: Device;
}

export interface World {
  github: FakeGitHub;
  /** Signs a member in on a new device, or on the browser `sameBrowserAs` runs in. */
  signIn: (login: string, options?: SignInOptions) => Promise<Device>;
  /** Holds the next request to GitHub that matches, to act while it is in flight. */
  holdGitHub: (matches: (request: Request) => boolean) => Hold;
  /** Calls the app's notebook routes directly, with `as`'s cookies (or none). */
  callApi: (
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string>; as?: Device },
  ) => Promise<Response>;
}

export function createWorld({ members = ["octo-member"] }: { members?: string[] } = {}): World {
  const github = createFakeGitHub();
  const app = github.addOAuthApp({ callbackUrl: `${appUrl}/api/auth/callback` });
  for (const login of members) github.addUser({ login });

  const holds: { matches: (request: Request) => boolean; reached: () => void; released: Promise<void> }[] = [];
  const toGitHub: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const hold = holds.find((candidate) => candidate.matches(request));
    if (hold) {
      holds.splice(holds.indexOf(hold), 1);
      hold.reached();
      await hold.released;
    }
    return github.handle(request);
  };

  const env = {
    NEXT_PUBLIC_APP_URL: appUrl,
    SESSION_SECRET: "a-test-session-secret-that-is-long-enough",
    GITHUB_CLIENT_ID: app.clientId,
    GITHUB_CLIENT_SECRET: app.clientSecret,
    OWNER_GITHUB_USER: members[0],
    ALLOWED_GITHUB_USERS: members.join(","),
  };
  const auth = authFromEnv(env, { fetch: toGitHub });
  const api = notebookApiFromEnv(env, { fetch: toGitHub });

  async function open(
    jar: CookieJar,
    indexedDB: IDBFactory,
    options: Pick<SyncEngineOptions, "timers">,
  ): Promise<Device> {
    const session = await auth.readSession(jar);
    if (!session) throw new Error("The device isn't signed in");
    const remote = createRemote({
      baseUrl: appUrl,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("cookie", jar.header());
        const request = new NextRequest(new URL(String(input), appUrl), {
          method: init?.method,
          headers,
          body: init?.body ?? undefined,
        });
        return api.handle(request);
      },
    });
    const store = await openDeviceStore({ account: session.member, indexedDB, IDBKeyRange });
    const engine = createSyncEngine({ store, remote, ...options });
    return {
      login: session.member.login,
      indexedDB,
      cookies: jar,
      store,
      engine,
      sync: () => engine.sync(),
      reopen: async () => {
        engine.stop();
        await store.close();
        return open(jar, indexedDB, options);
      },
    };
  }

  return {
    github,

    signIn: async (login, { sameBrowserAs, ...options } = {}) => {
      const jar = new CookieJar();
      const start = await auth.signIn(new NextRequest(`${appUrl}/api/auth/login`));
      jar.store(start);
      const callback = await github.authorize(start.headers.get("location") ?? "", { login });
      jar.store(await auth.callback(new NextRequest(callback, { headers: { cookie: jar.header() } })));
      return open(jar, sameBrowserAs?.indexedDB ?? new IDBFactory(), options);
    },

    callApi: (path, { method = "GET", body, headers = {}, as } = {}) => {
      // Bytes (an attachment) go as they are, under the caller's content type; anything else is JSON.
      const raw = body instanceof Uint8Array || body instanceof Blob;
      return api.handle(
        new NextRequest(new URL(path, appUrl), {
          method,
          headers: {
            ...(as ? { cookie: as.cookies.header() } : {}),
            ...(body === undefined || raw ? {} : { "content-type": "application/json" }),
            ...headers,
          },
          body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
        }),
      );
    },

    holdGitHub: (matches) => {
      let reached!: () => void;
      let release!: () => void;
      const hold = {
        matches,
        reached: () => reached(),
        released: new Promise<void>((resolve) => (release = resolve)),
      };
      const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
      holds.push(hold);
      return { reached: reachedPromise, release };
    },
  };
}
