/**
 * Static file serving endpoints
 * Handles serving the React app and static assets
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Serve static files from dist directory (built React app)
 */
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(content);
    }
  });
}

/**
 * Handle static file requests, with Vite middleware fallback
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Object} viteServer - Vite dev server instance (optional)
 * @param {string} pathname - Request pathname
 */
function handleStaticRequest(req, res, viteServer, pathname) {
  // Prefer Vite middleware in development for non-API routes (HMR & asset serving)
  if (viteServer && viteServer.middlewares) {
    try {
      // Let Vite handle all non-API requests (including assets). If Vite calls next,
      // fall back to static handlers below.
      return viteServer.middlewares(req, res, () => {
        if (pathname === "/" || pathname === "/index.html") {
          serveStatic(res, path.join(__dirname, "dist", "index.html"));
        } else if (pathname.startsWith("/assets/")) {
          const assetPath = pathname.substring(1); // Remove leading slash
          serveStatic(res, path.join(__dirname, "dist", assetPath));
        } else if (pathname.startsWith("/public/")) {
          const publicPath = pathname.substring(1); // Remove leading slash
          serveStatic(
            res,
            path.join(__dirname, "public", publicPath.replace("public/", ""))
          );
        } else {
          // Fallback to index.html for client-side routing
          serveStatic(res, path.join(__dirname, "dist", "index.html"));
        }
      });
    } catch (err) {
      console.error("Vite middleware error:", err);
      // Fallback to serving built assets
      serveStatic(res, path.join(__dirname, "dist", "index.html"));
    }
  } else {
    // No Vite dev server available; serve static files from dist/public as before
    if (pathname === "/" || pathname === "/index.html") {
      serveStatic(res, path.join(__dirname, "dist", "index.html"));
    } else if (pathname.startsWith("/assets/")) {
      // Serve assets from dist/assets
      const assetPath = pathname.substring(1); // Remove leading slash
      serveStatic(res, path.join(__dirname, "dist", assetPath));
    } else if (pathname.startsWith("/public/")) {
      // Serve static files from public directory
      const publicPath = pathname.substring(1); // Remove leading slash
      serveStatic(
        res,
        path.join(__dirname, "public", publicPath.replace("public/", ""))
      );
    } else {
      // For any other route, serve the React app's index.html
      // This allows client-side routing to work
      serveStatic(res, path.join(__dirname, "dist", "index.html"));
    }
  }
}

export { serveStatic, handleStaticRequest };
