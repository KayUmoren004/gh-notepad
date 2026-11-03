import { appUrl } from "./support/env";
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

test("the landing page describes itself to search engines and link previews", async ({ page, request }) => {
  await page.goto("/");
  const content = (selector: string) => page.locator(selector).getAttribute("content");

  await expect(page).toHaveTitle("Notepad: your notes, in your own GitHub");
  expect(await content('meta[name="description"]')).toContain("Markdown");
  expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) ?? "").href).toBe(`${appUrl}/`);

  expect(await content('meta[property="og:type"]')).toBe("website");
  expect(await content('meta[property="og:site_name"]')).toBe("Notepad");
  expect(await content('meta[property="og:title"]')).toBeTruthy();
  expect(await content('meta[property="og:description"]')).toContain("Markdown");
  expect(await content('meta[property="og:image:alt"]')).toBeTruthy();
  expect(await content('meta[name="twitter:card"]')).toBe("summary_large_image");

  // Link previews fetch the image from another server, so its URL must be absolute.
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const url = (await content(selector)) ?? "";
    expect(url.startsWith(`${appUrl}/`), `${selector} is ${url}`).toBe(true);

    const image = await request.get(url);
    expect(image.headers()["content-type"]).toBe("image/png");
    const png = await image.body();
    // A PNG's IHDR chunk holds its width and height at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  }
});
