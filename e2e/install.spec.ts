import type { Page } from "@playwright/test";
import { members } from "./support/env";
import { expect, test } from "./support/fixtures";
import { installTimeout, startDeployment, waitUntilControlled } from "./support/service-worker";

// The installed app runs with its service worker, which every other spec blocks (playwright.config.ts).
test.use({ serviceWorkers: "allow" });

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

/** A PNG's width × height, read from its header. */
function pngSize(bytes: Buffer): string {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

/** `#rrggbb` as `getComputedStyle` reports it. */
function rgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${red}, ${green}, ${blue})`;
}

// Chrome's own installability verdict (`Page.getInstallabilityErrors`, which Lighthouse's
// installable-manifest audit reads) now reports every page as installable, manifest or not,
// so these tests check the install criteria themselves.

test("Chrome reads the manifest without errors: a standalone app that opens the notes", async ({ page, context }) => {
  await page.goto("/");

  const devTools = await context.newCDPSession(page);
  const { errors, manifest } = await devTools.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  expect(manifest).toMatchObject({
    name: "Notepad",
    display: "kStandalone",
    startUrl: new URL("/notes", page.url()).href,
    scope: new URL("/", page.url()).href,
  });
});

test("the manifest names the app in the page's colours, with any and maskable icons at install sizes", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const manifestUrl = (await page.locator('link[rel="manifest"]').getAttribute("href")) ?? "";
  const manifest = await (await request.get(manifestUrl)).json();
  const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
  const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(manifest).toMatchObject({
    name: "Notepad",
    short_name: "Notepad",
    start_url: "/notes",
    display: "standalone",
    theme_color: themeColor,
  });
  // The splash screen shows this colour, then the app paints its own: they must be the same.
  expect(rgb(manifest.background_color)).toBe(pageBackground);

  for (const purpose of ["any", "maskable"]) {
    const icons = (manifest.icons as ManifestIcon[]).filter((icon) => icon.purpose.split(" ").includes(purpose));
    expect(icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of icons) {
      const response = await request.get(icon.src);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(pngSize(await response.body())).toBe(icon.sizes);
    }
  }
});

test("the browser tab and the iOS home screen get the app's icons", async ({ page, request }) => {
  await page.goto("/");

  const favicons = await page.locator('link[rel="icon"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  expect(favicons.length).toBeGreaterThan(0);
  for (const href of favicons) expect((await request.get(href)).ok()).toBe(true);

  const touchIcon = (await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")) ?? "";
  expect(pngSize(await (await request.get(touchIcon)).body())).toBe("180x180");
  // Installed, iOS draws its status bar over the page; the page pads itself clear (next test).
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black-translucent",
  );
});

/** An installed app on a notched phone: status bar and notch, home indicator, and landscape's side insets. */
const insets = { top: 47, right: 44, bottom: 34, left: 44 };

/** Controls and headings that reach into the safe-area insets, at the top and at the end of the page. */
async function intoTheInsets(page: Page) {
  return page.evaluate(async (insets) => {
    const offenders = new Set<string>();
    const check = (edge: "top" | "bottom") => {
      for (const element of document.querySelectorAll("a, button, input, textarea, select, h1, h2, h3, [role=status]")) {
        const box = element.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1 || element.closest("[aria-hidden=true], [inert]")) continue;
        const outside =
          box.left < insets.left ||
          box.right > innerWidth - insets.right ||
          (edge === "top" ? box.top < insets.top : box.bottom > innerHeight - insets.bottom && box.top < innerHeight);
        if (outside) offenders.add(`${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`);
      }
    };
    scrollTo(0, 0);
    check("top");
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(requestAnimationFrame);
    check("bottom");
    scrollTo(0, 0);
    return [...offenders];
  }, insets);
}

test("installed on a notched phone, every screen keeps its controls clear of the insets", async ({
  page,
  context,
  signInAs,
}) => {
  const devTools = await context.newCDPSession(page);
  await devTools.send("Emulation.setSafeAreaInsetsOverride", { insets });

  await page.goto("/");
  const topInset = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.paddingTop = "env(safe-area-inset-top)";
    const value = getComputedStyle(probe).paddingTop;
    probe.remove();
    return value;
  });
  expect(topInset).toBe(`${insets.top}px`);
  expect(await intoTheInsets(page)).toEqual([]);

  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");
  expect(await intoTheInsets(page)).toEqual([]);

  await context.setOffline(true);
  await page.goto("/invite-only");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  expect(await intoTheInsets(page)).toEqual([]);
});

test("a new version waits for the member, offered quietly and clear of the insets, until Reload", async ({
  page,
  context,
}) => {
  const deployment = await startDeployment();
  try {
    const devTools = await context.newCDPSession(page);
    await devTools.send("Emulation.setSafeAreaInsetsOverride", { insets });
    await page.goto(deployment.url);
    await waitUntilControlled(page);
    const prompt = page.getByRole("status").filter({ hasText: "Update available" });
    await expect(prompt).toHaveCount(0);

    deployment.deployNewVersion();
    // Browsers look for a new version of the worker on every page load.
    await page.reload();
    await expect(prompt).toBeVisible(installTimeout);
    expect(await intoTheInsets(page)).toEqual([]);
    await prompt.getByRole("button", { name: "Dismiss" }).click();
    await expect(prompt).toHaveCount(0);

    // Dismissed or ignored, the new version never takes over the open app by itself.
    await page.reload();
    await expect(prompt).toBeVisible();

    const reloaded = page.waitForEvent("load");
    await prompt.getByRole("button", { name: "Reload" }).click();
    await reloaded;
    await expect(prompt).toHaveCount(0);
    const worker = await page.evaluate(async () => ({
      waiting: !!(await navigator.serviceWorker.getRegistration())?.waiting,
      controller: navigator.serviceWorker.controller?.state,
    }));
    expect(worker).toEqual({ waiting: false, controller: "activated" });
  } finally {
    await deployment.close();
  }
});
