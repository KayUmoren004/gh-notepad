import { test as base, type Page } from "@playwright/test";
import { connectFakeGitHub, type FakeGitHubControl } from "../../test/fake-github/client";
import { fakeGitHubUrl } from "./env";

export { expect } from "@playwright/test";

interface Fixtures {
  /** The fake GitHub the app is pointed at, seeded and inspected over its control API. */
  fakeGitHub: FakeGitHubControl;
  /** Signs this page in through the fake GitHub as `login`, seeding the account first. */
  signInAs: (login: string) => Promise<void>;
  /**
   * Opens another browser (a fresh context with its own storage and cookies,
   * emulating the same device) signed in as `login`, and returns its page.
   */
  signInOnAnotherDevice: (login: string) => Promise<Page>;
}

async function signIn(page: Page, fakeGitHub: FakeGitHubControl, login: string) {
  await fakeGitHub.addUser({ login });
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: `Authorize as ${login}` }).click();
}

export const test = base.extend<Fixtures>({
  // Playwright requires the destructuring pattern even when no fixture is used.
  fakeGitHub: async ({}, use) => {
    await use(connectFakeGitHub(fakeGitHubUrl));
  },

  signInAs: async ({ page, fakeGitHub }, use) => {
    await use((login) => signIn(page, fakeGitHub, login));
  },

  signInOnAnotherDevice: async (
    { browser, fakeGitHub, baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, serviceWorkers },
    use,
  ) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (login) => {
      // `browser.newContext()` takes none of the project's options, so the service worker setting is passed on too.
      const context = await browser.newContext({
        baseURL,
        viewport,
        userAgent,
        isMobile,
        hasTouch,
        deviceScaleFactor,
        serviceWorkers,
      });
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, fakeGitHub, login);
      return page;
    });
    for (const context of contexts) await context.close();
  },
});
