import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Benchmarks are not tests: they run under their own config and command (`pnpm bench`), never as part of
// the desktop or backend test runs, and they take minutes rather than seconds.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../apps/desktop/src", import.meta.url)) },
  },
  test: {
    include: ["suites/**/*.bench.ts"],
    environment: "node",
    // A suite must never share a process with another while it measures.
    pool: "forks",
    fileParallelism: false,
    silent: false,
    disableConsoleIntercept: true,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
