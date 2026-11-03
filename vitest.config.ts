import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("."),
      // `server-only` throws outside React Server Components. Unit tests run
      // server modules directly, so it resolves to an empty module here.
      "server-only": fromRoot("test/stubs/server-only.ts"),
    },
  },
  test: {
    // Unit and integration tests are `*.test.ts(x)` files next to the code
    // they cover. Playwright owns `e2e/*.spec.ts`.
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**", ".claude/**"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
  },
});
