/// <reference lib="webworker" />
/**
 * The service worker, bundled by `app/serwist/[path]/route.ts` and served at
 * `/serwist/sw.js`. It caches code, never data: the build's static assets are
 * precached, the signed-in app shell is kept so `/notes` opens with no network,
 * and `/api/*` is left alone entirely, so no API response is ever stored or
 * served from here. Notes themselves live in IndexedDB.
 */
import { NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    /** The precache manifest, injected at build time. */
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** The app shell's document: the client-rendered notes screen boots from it. */
const APP_SHELL = "/notes";
/** Precached; answers any page navigation the network and the shell can't. */
const OFFLINE_PAGE = "/~offline";
const SIGN_OUT = "/api/auth/logout";
/** Signed-in documents only, so it is cleared whenever the member is signed out. */
const SHELL_CACHE = "app-shell";

const isAppShell = (url: URL) => url.pathname === APP_SHELL || url.pathname.startsWith(`${APP_SHELL}/`);
const isApi = (url: URL) => url.pathname === "/api" || url.pathname.startsWith("/api/");
/** A soft navigation's React Server Components payload, not a document. */
const isRscRequest = (request: Request) => request.headers.has("RSC");
/** The server redirects app pages to the landing page when no one is signed in. */
const isRedirect = (response: Response) =>
  response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400);

const forgetSignedInPages = () => caches.delete(SHELL_CACHE);

/** Keeps only signed-in shells, and drops every one the moment the server says no one is signed in. */
const signedInShellOnly: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) => (response.status === 200 && !isRedirect(response) ? response : null),
  fetchDidSucceed: async ({ response }) => {
    if (isRedirect(response)) await forgetSignedInPages();
    return response;
  },
};

const serwist: Serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // A new version waits for the member to choose "Reload" (components/update-prompt.tsx).
  skipWaiting: false,
  clientsClaim: true,
  // No navigation preload: it would send every navigation twice, including the
  // sign-in routes, whose cookies must be set exactly once.
  navigationPreload: false,
  runtimeCaching: [
    {
      // Network first, so the shell is always the latest; the cached copy only answers offline.
      matcher: ({ request, url, sameOrigin }) => sameOrigin && isAppShell(url) && !isRscRequest(request),
      method: "GET",
      handler: new NetworkFirst({
        cacheName: SHELL_CACHE,
        plugins: [
          signedInShellOnly,
          {
            // Offline and never seen at this URL: any signed-in shell boots the client-rendered app.
            handlerDidError: async (): Promise<Response | undefined> =>
              (await caches.match(APP_SHELL, { cacheName: SHELL_CACHE })) ?? (await serwist.matchPrecache(OFFLINE_PAGE)),
          },
        ],
      }),
    },
    {
      // Other pages (landing, invite-only) need the network; offline they get the offline page.
      matcher: ({ request, url, sameOrigin }) => sameOrigin && request.mode === "navigate" && !isApi(url),
      method: "GET",
      handler: new NetworkOnly({
        plugins: [{ handlerDidError: (): Promise<Response | undefined> => serwist.matchPrecache(OFFLINE_PAGE) }],
      }),
    },
  ],
});

/**
 * Stores the shell that matches this build's precached assets. Runs while a new
 * version installs, so the old shell (pointing at assets about to be removed)
 * is replaced before the new version takes over.
 */
async function refreshAppShell() {
  let response: Response;
  try {
    response = await fetch(APP_SHELL, { redirect: "manual", cache: "reload" });
  } catch {
    return; // Offline: keep the shell there is.
  }
  if (isRedirect(response)) return forgetSignedInPages();
  if (response.status !== 200) return;
  await caches.delete(SHELL_CACHE);
  await (await caches.open(SHELL_CACHE)).put(APP_SHELL, response);
}

self.addEventListener("install", (event) => event.waitUntil(refreshAppShell()));

// A page asks for itself to be cached when this worker didn't serve it. Such a page
// may have started loading before activation, too late for the claim made then, so it
// is claimed now: its later requests (lazily loaded code) then come from the precache.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_URLS") event.waitUntil(self.clients.claim());
});

// Signing out forgets the signed-in shell, so this device can't open the app offline afterwards.
// The request itself goes to the network untouched.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === SIGN_OUT) {
    event.waitUntil(forgetSignedInPages());
  }
});

serwist.addEventListeners();
