import viteConfig from "./vite.config.js";

export default {
  ...viteConfig,
  test: {
    ...(viteConfig.test ?? {}),
    setupFiles: ["./tests/setup.js"],
    environment: "jsdom",
  },
};
