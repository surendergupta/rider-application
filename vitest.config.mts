import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // The default worker pools fail to initialise the runner on this machine (even for an empty test);
    // vmThreads runs the same tests correctly.
    pool: "vmThreads",
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
