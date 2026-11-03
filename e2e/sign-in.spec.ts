import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

test("an allowed member signs in through GitHub and lands in the app", async ({ page, signInAs }) => {
  await signInAs(members.allowed);

  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("img", { name: members.allowed })).toBeVisible();

  // Signed-in visitors skip the landing page.
  await page.goto("/");
  await expect(page).toHaveURL("/notes");
});

test("a login that isn't allowed sees the invite-only screen and stays signed out", async ({ page, signInAs }) => {
  await signInAs(members.stranger);

  await expect(page).toHaveURL(`/invite-only?login=${members.stranger}`);
  await expect(page.getByRole("heading", { name: "This notepad is invite-only" })).toBeVisible();
  await expect(page.getByText(`@${members.stranger}`)).toBeVisible();

  await page.goto("/notes");
  await expect(page).toHaveURL("/");
});

test("signing out returns to the landing page", async ({ page, signInAs }) => {
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Keep notes on this device" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Sign in with GitHub" })).toBeVisible();
  await page.goto("/notes");
  await expect(page).toHaveURL("/");
});

test("a callback this browser didn't start is rejected", async ({ page }) => {
  await page.goto("/api/auth/callback?code=forged-code&state=forged-state");

  await expect(page).toHaveURL("/?sign-in=failed");
  await expect(page.getByRole("alert").filter({ hasText: "Sign-in didn't finish" })).toBeVisible();
  await page.goto("/notes");
  await expect(page).toHaveURL("/");
});

test("the GitHub token is never readable from page scripts", async ({ page, context, signInAs, fakeGitHub }) => {
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");

  const tokens = await fakeGitHub.accessTokensFor(members.allowed);
  expect(tokens.length).toBeGreaterThan(0);
  const readable = await page.evaluate(
    () =>
      document.cookie +
      document.documentElement.outerHTML +
      JSON.stringify({ ...localStorage }) +
      JSON.stringify({ ...sessionStorage }),
  );
  for (const token of tokens) expect(readable).not.toContain(token);

  const cookies = await context.cookies();
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) expect(cookie.httpOnly).toBe(true);
});
