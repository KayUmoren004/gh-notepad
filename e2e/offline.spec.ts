import type { Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// These flows need the service worker, which every other spec blocks (playwright.config.ts).
test.use({ serviceWorkers: "allow" });

/** Installing the worker precaches the whole build, which takes a while under parallel load. */
const installTimeout = { timeout: 15_000 };

/** Resolves once the service worker has stored the page this tab is showing. */
async function waitUntilAvailableOffline(page: Page) {
  await expect.poll(() => page.evaluate(async () => !!(await caches.match(location.href))), installTimeout).toBe(true);
}

/** Resolves once the service worker sees this tab's requests. */
async function waitUntilControlled(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), installTimeout).toBe(true);
}

test("the signed-in app opens offline after one online visit", async ({ page, context, signInAs }) => {
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");
  await waitUntilAvailableOffline(page);

  await context.setOffline(true);
  const response = await page.reload();

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator("[data-app-shell]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("authenticated API responses are never stored or served by the service worker", async ({
  page,
  context,
  signInAs,
}) => {
  // Stands in for the app's route handlers, answering at the network. `context.route()`
  // sees the service worker's own requests too, so a worker that cached these would be caught.
  await context.route("**/api/probe/**", (route) =>
    route.fulfill({ json: { notes: ["private"] }, headers: { "cache-control": "private, max-age=3600" } }),
  );
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");
  await waitUntilControlled(page);

  const get = (path: string) =>
    page.evaluate((url) => fetch(url).then((response) => response.status, () => "unreachable"), path);
  expect(await get("/api/probe/notes")).toBe(200);
  expect(await get("/api/probe/notes?since=1")).toBe(200);
  await page.goto("/api/probe/document");
  await page.goto("/notes");

  await context.unroute("**/api/probe/**");
  await context.setOffline(true);
  expect(await get("/api/probe/notes")).toBe("unreachable");
  expect(await get("/api/probe/notes?since=1")).toBe("unreachable");

  const cachedApiUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls.filter((url) => new URL(url).pathname.startsWith("/api/"));
  });
  expect(cachedApiUrls).toEqual([]);
});
