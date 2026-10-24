import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "licenses/**",
      "THIRD_PARTY_NOTICES.md",
      "package-lock.json",
    ],
    printWidth: 80,
  },
  lint: {
    categories: { correctness: "error" },
    rules: { "no-unused-vars": "error" },
  },
  staged: {
    "*": "vp check --fix --deny-warnings --no-error-on-unmatched-pattern",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Cold Cargo builds and consumer package installs run in these tests.
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
});
