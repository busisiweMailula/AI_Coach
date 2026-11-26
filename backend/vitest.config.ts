import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/dist/**"],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    clearMocks: true,
  },
});

