import { test as base } from "@playwright/test";
import { connectFakeGitHub, type FakeGitHubControl } from "../../test/fake-github/client";
import { fakeGitHubUrl } from "./env";

export { expect } from "@playwright/test";

interface Fixtures {
  /** The fake GitHub the app is pointed at, seeded and inspected over its control API. */
  fakeGitHub: FakeGitHubControl;
  /** Signs this page in through the fake GitHub as `login`, seeding the account first. */
  signInAs: (login: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  // Playwright requires the destructuring pattern even when no fixture is used.
  fakeGitHub: async ({}, use) => {
    await use(connectFakeGitHub(fakeGitHubUrl));
  },

  signInAs: async ({ page, fakeGitHub }, use) => {
    await use(async (login) => {
      await fakeGitHub.addUser({ login });
      await page.goto("/");
      await page.getByRole("link", { name: "Sign in with GitHub" }).click();
      await page.getByRole("button", { name: `Authorize as ${login}` }).click();
    });
  },
});
