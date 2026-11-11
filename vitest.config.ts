import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "browser",
          include: ["src/**/*.test.ts"],
          exclude: ["src/server.test.ts"],
          setupFiles: ["test/setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
      },
      {
        test: {
          name: "node",
          include: ["src/server.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
