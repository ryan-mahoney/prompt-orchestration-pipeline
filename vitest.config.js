import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file patterns
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],

    // Global setup files
    setupFiles: ["./tests/setup.js"],

    // Use jsdom environment for all tests
    environment: "jsdom",

    // Test timeout
    testTimeout: 60000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "coverage/**",
        "dist/**",
        "**/node_modules/**",
        "**/[.]**",
        "**/*.config.*",
        "**/tests/**",
        "**/demo/**",
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },

    // Mock configuration
    mockReset: true,
    restoreMocks: true,

    // Watch mode configuration
    watchExclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/demo/**",
    ],
  },
});
