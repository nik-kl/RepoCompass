import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Applied before test files (and their imports) are evaluated, so
    // src/config.ts validates cleanly in every test environment.
    env: {
      NODE_ENV: "test",
      GITHUB_APP_ID: "1",
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_PRIVATE_KEY: "not-used-in-tests",
      // Small retrieval window so tests can assert on exact top-k results.
      RAG_TOP_K: "1",
    },
    include: ["test/**/*.test.ts"],
    // The local embedding model downloads on first use; give it headroom.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
