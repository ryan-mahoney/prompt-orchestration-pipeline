import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**"],
    environment: "node",
    testTimeout: 20000,
  },
});
