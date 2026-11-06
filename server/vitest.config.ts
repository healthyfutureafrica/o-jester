import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-test-secret-test-secret-123",
      DATABASE_URL: "file:./test.db",
      FOOTBALL_PROVIDER: "football-data",
      FOOTBALL_DATA_KEY: "test-key",
    },
  },
});
