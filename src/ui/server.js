/**
 * Single Node.js server handling static files, API, and SSE
 * Serves UI and provides real-time file change updates
 */

import http from "http";
import fs from "fs";
import path from "path";
import url from "url";
import { fileURLToPath } from "url";
import { start as startWatcher, stop as stopWatcher } from "./watcher.js";
import * as state from "./state.js";
import { submitJobWithValidation } from "../api/index.js";
import { sseRegistry } from "./sse.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 4000;
const WATCHED_PATHS = (process.env.WATCHED_PATHS || "pipeline-config,runs")
  .split(",")
  .map((p) => p.trim());
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DATA_DIR = process.env.PO_ROOT || process.cwd();

// SSE clients management
let heartbeatTimer = null;

/**
 * Send SSE message to a client
 */
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast state update to all SSE clients
 */
function broadcastStateUpdate(currentState) {
  sseRegistry.broadcast({
    type: "state",
    data: currentState,
  });
}

/**
 * Start heartbeat to keep connections alive
 */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    sseRegistry.broadcast({
      type: "heartbeat",
      data: { timestamp: Date.now() },
    });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Parse multipart form data
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {Promise<Object>} Parsed form data with file content
 */
function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let boundary = null;

    // Extract boundary from content-type header
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Invalid content-type: expected multipart/form-data"));
      return;
    }

    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      reject(new Error("Missing boundary in content-type"));
      return;
    }

    boundary = `--${boundaryMatch[1]}`;

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const data = buffer.toString("utf8");

        // Simple multipart parsing - look for file field
        const parts = data.split(boundary);

        for (const part of parts) {
          if (part.includes('name="file"') && part.includes("filename")) {
            // Extract filename
            const filenameMatch = part.match(/filename="([^"]+)"/);
            if (!filenameMatch) continue;

            // Extract content type
            const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/);

            // Extract file content (everything after the headers)
            const contentStart = part.indexOf("\r\n\r\n") + 4;
            const contentEnd = part.lastIndexOf("\r\n");
            const fileContent = part.substring(contentStart, contentEnd);

            resolve({
              filename: filenameMatch[1],
              contentType: contentTypeMatch
                ? contentTypeMatch[1]
                : "application/octet-stream",
              content: fileContent,
            });
            return;
          }
        }

        reject(new Error("No file field found in form data"));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

/**
 * Handle seed file upload
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 */
async function handleSeedUpload(req, res) {
  try {
    // Parse multipart form data
    const formData = await parseMultipartFormData(req);

    // Validate that we have file content
    if (!formData.content) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message: "No file content found",
        })
      );
      return;
    }

    // Parse JSON content
    let seedObject;
    try {
      seedObject = JSON.parse(formData.content);
    } catch (parseError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message: "Invalid JSON",
        })
      );
      return;
    }

    // Use current PO_ROOT or fallback to DATA_DIR
    const currentDataDir = process.env.PO_ROOT || DATA_DIR;

    // Submit job with validation
    const result = await submitJobWithValidation({
      dataDir: currentDataDir,
      seedObject,
    });

    // Send appropriate response
    if (result.success) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

      // Broadcast SSE event for successful upload
      sseRegistry.broadcast({
        type: "seed:uploaded",
        data: { jobName: result.jobName },
      });
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    }
  } catch (error) {
    console.error("Upload error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        message: "Internal server error",
      })
    );
  }
}

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
 * Create and start the HTTP server
 */
function createServer() {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers for API endpoints
    if (pathname.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Route: GET /api/state
    if (pathname === "/api/state" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.getState()));
      return;
    }

    // Route: GET /api/events (SSE)
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Send initial state
      sendSSE(res, "state", state.getState());

      // Add to SSE registry
      sseRegistry.addClient(res);

      // Remove client on disconnect
      req.on("close", () => {
        sseRegistry.removeClient(res);
      });

      return;
    }

    // Route: POST /api/upload/seed
    if (pathname === "/api/upload/seed" && req.method === "POST") {
      await handleSeedUpload(req, res);
      return;
    }

    // Serve static files from dist directory (built React app)
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
  });

  return server;
}

/**
 * Initialize file watcher
 */
let watcher = null;

function initializeWatcher() {
  state.setWatchedPaths(WATCHED_PATHS);

  watcher = startWatcher(WATCHED_PATHS, (changes) => {
    // Update state for each change
    changes.forEach(({ path, type }) => {
      state.recordChange(path, type);
    });

    // Broadcast updated state
    broadcastStateUpdate(state.getState());
  });
}

/**
 * Start the server
 */
function start(customPort) {
  const port = customPort || PORT;
  const server = createServer();

  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Watching paths: ${WATCHED_PATHS.join(", ")}`);

    initializeWatcher();
    startHeartbeat();
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down gracefully...");

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watcher) await stopWatcher(watcher);

    sseRegistry.closeAll();

    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });

  return server;
}

// Export for testing
export {
  createServer,
  start,
  broadcastStateUpdate,
  sseRegistry,
  initializeWatcher,
  state,
};

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
