import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "#": path.resolve(import.meta.dirname, "agent"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
