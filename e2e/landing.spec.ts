import { expect, test } from "./support/fixtures";

test("a signed-out visitor learns what the notepad is and how to get in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("GitHub");
  for (const feature of [
    "Markdown files in your GitHub",
    "Works offline",
    "Rich text or raw Markdown",
    "Version history",
    "Sharing",
  ]) {
    await expect(page.getByRole("heading", { name: feature })).toBeVisible();
  }

  await expect(page.getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute("href", "/api/auth/login");
  await expect(page.getByText("This notepad is invite-only", { exact: false }).first()).toBeVisible();
});
