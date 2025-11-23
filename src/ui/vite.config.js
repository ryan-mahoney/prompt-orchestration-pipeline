import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Fix the publicDir path to resolve the static assets issue.
// Vite was looking in src/ui/client/public (relative to root),
// but public assets are in src/ui/public.
// By setting publicDir to an absolute path, Vite will copy
// contents of src/ui/public to dist during build.
const publicDir = new URL("./public", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  root: "src/ui/client",
  build: {
    outDir: "../../dist", // Output to src/ui/dist
  },
  publicDir,
  server: {
    cors: true,
  },
});
