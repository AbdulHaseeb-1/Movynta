import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Assistant quality runs call a real model through the backend and take as long as the model takes. They have their own
// config and command (`pnpm quality`) so that `pnpm bench` never starts one.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../apps/desktop/src", import.meta.url)) },
  },
  test: {
    include: ["quality/**/*.live.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    silent: false,
    disableConsoleIntercept: true,
    // A whole sweep can run for hours; each scenario still has its own time limit.
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 120_000,
  },
});
