import { defineConfig, devices } from "@playwright/test";
import { appEnv, appUrl, fakeGitHubEnv, fakeGitHubUrl } from "./e2e/support/env";

const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "npm run fake-github",
      url: `${fakeGitHubUrl}/_fake/health`,
      env: fakeGitHubEnv,
      reuseExistingServer: !ci,
    },
    {
      // A production build, as the Next.js testing guide recommends.
      command: `npm run build && npm run start -- --port ${new URL(appUrl).port}`,
      url: appUrl,
      env: appEnv,
      timeout: 300_000,
      reuseExistingServer: !ci,
    },
  ],
});
