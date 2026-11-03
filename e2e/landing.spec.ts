import type { Page } from "@playwright/test";
import { appUrl } from "./support/env";
import { expect, test } from "./support/fixtures";

/** Freezes every animation on its first frame and reports what each animated element looks like there. */
function firstFrames(page: Page) {
  return page.evaluate(() =>
    document.getAnimations().map((animation) => {
      animation.pause();
      animation.currentTime = 0;
      const style = getComputedStyle((animation.effect as KeyframeEffect).target as Element);
      return {
        opacity: Number(style.opacity),
        moved: style.transform !== "none" && style.transform !== "matrix(1, 0, 0, 1, 0, 0)",
      };
    }),
  );
}

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

test("the page rises into place once on load, then holds still", async ({ page }) => {
  await page.goto("/");
  const frames = await firstFrames(page);
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expect(frame).toEqual({ opacity: 0, moved: true });

  await page.goto("/");
  const settled = () =>
    page.evaluate(() => document.getAnimations().every((animation) => animation.playState === "finished"));
  await expect.poll(settled, { timeout: 1_000 }).toBe(true);

  // Nothing waits for the visitor to scroll, and nothing loops.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  expect(await settled()).toBe(true);
});

test("with reduced motion the entrance only fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const frames = await firstFrames(page);
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) expect(frame).toEqual({ opacity: 0, moved: false });
});
