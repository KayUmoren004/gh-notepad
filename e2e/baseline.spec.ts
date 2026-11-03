import { members } from "./support/env";
import { expect, test } from "./support/fixtures";

// The design and mobile-native baseline every screen inherits from the root
// layout and global styles. What emulation can't show (safe areas, the
// software keyboard, real tap latency) still needs a phone.

test("the viewport reaches under the notch without disabling zoom", async ({ page }) => {
  await page.goto("/");

  const viewport = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).not.toMatch(/user-scalable|maximum-scale/);
});

test("the browser chrome takes the page's background color", async ({ page }) => {
  await page.goto("/");

  const themeColor = (await page.locator('meta[name="theme-color"]').getAttribute("content")) ?? "";
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(themeColor.slice(start, start + 2), 16));
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe(`rgb(${red}, ${green}, ${blue})`);
});

test("global styles remove the tells of a website", async ({ page }) => {
  await page.goto("/");

  const styles = await page.evaluate(() => {
    const button = document.body.appendChild(document.createElement("button"));
    const input = document.body.appendChild(document.createElement("input"));
    const root = getComputedStyle(document.documentElement);
    const result = {
      colorScheme: root.colorScheme,
      tapHighlight: root.getPropertyValue("-webkit-tap-highlight-color"),
      overscroll: root.overscrollBehaviorY,
      buttonTouchAction: getComputedStyle(button).touchAction,
      buttonUserSelect: getComputedStyle(button).userSelect,
      inputFontSize: getComputedStyle(input).fontSize,
      bodyUserSelect: getComputedStyle(document.body).userSelect,
    };
    button.remove();
    input.remove();
    return result;
  });

  expect(styles).toEqual({
    colorScheme: "dark",
    tapHighlight: "rgba(0, 0, 0, 0)",
    overscroll: "none",
    buttonTouchAction: "manipulation",
    buttonUserSelect: "none",
    inputFontSize: "16px",
    bodyUserSelect: "auto",
  });
});

test("hover styles only apply to fine pointers", async ({ page }) => {
  await page.goto("/");

  const ungated = await page.evaluate(() => {
    const found: string[] = [];
    const visit = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of rules) {
        const inside =
          gated ||
          (rule instanceof CSSMediaRule && /hover:\s*hover/.test(rule.conditionText) && /pointer:\s*fine/.test(rule.conditionText));
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(":hover") && !inside) found.push(rule.selectorText);
        if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList) visit(rule.cssRules, inside);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules, false);
    return found;
  });

  expect(ungated).toEqual([]);
});

test("motion falls back to fades when reduced motion is requested", async ({ page }) => {
  await page.goto("/");
  const movement = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return ["--press-scale", "--enter-offset", "--enter-scale"].map((name) => root.getPropertyValue(name).trim());
    });

  expect(await movement()).not.toEqual(["1", "0px", "1"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await movement()).toEqual(["1", "0px", "1"]);
});

test("the app shell fills the dynamic viewport", async ({ page, signInAs }) => {
  await signInAs(members.allowed);
  await expect(page).toHaveURL("/notes");

  const [shell, viewport] = await page.evaluate(() => [
    document.querySelector("[data-app-shell]")?.getBoundingClientRect().height,
    window.innerHeight,
  ]);
  expect(shell).toBe(viewport);
});
