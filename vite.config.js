import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: "src/ui/client",

  // ADD THIS LINE:
  publicDir: path.resolve(__dirname, "src/ui/public"),

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsDir: "assets",
    cssCodeSplit: false, // Ensure CSS is bundled properly
    minify: false, // Disable minification for better debugging
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    loader: "jsx", // Default loader for all files
    include: /.*\.jsx?$/, // Apply to both .js and .jsx files
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { ".js": "jsx" },
    },
  },
  css: {
    postcss: "./postcss.config.mjs", // Explicitly point to PostCSS config
  },
  server: {
    port: 5173,
    fs: {
      allow: ["../../"], // Allow access to project root
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/events": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
  // Vitest configuration moved from vitest.config.js
  test: {
    // Test file patterns - include tests from project root
    include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],

    // Global setup files (includes hard timeout watchdog)
    setupFiles: ["./tests/setup.js"],
    globalSetup: ["./tests/hard-timeout.global.js"],

    // Use jsdom environment for all tests
    environment: "jsdom",

    // Test timeout
    testTimeout: 20000,
    hookTimeout: 5000,
    teardownTimeout: 10000,

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
