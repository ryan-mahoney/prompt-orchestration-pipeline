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

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 4000;
const WATCHED_PATHS = (process.env.WATCHED_PATHS || "pipeline-config,runs")
  .split(",")
  .map((p) => p.trim());
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// SSE clients management
const sseClients = new Set();
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
  const deadClients = new Set();

  sseClients.forEach((client) => {
    try {
      sendSSE(client, "state", currentState);
    } catch (err) {
      deadClients.add(client);
    }
  });

  // Clean up dead connections
  deadClients.forEach((client) => sseClients.delete(client));
}

/**
 * Start heartbeat to keep connections alive
 */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    const deadClients = new Set();

    sseClients.forEach((client) => {
      try {
        client.write(":heartbeat\n\n");
      } catch (err) {
        deadClients.add(client);
      }
    });

    deadClients.forEach((client) => sseClients.delete(client));
  }, HEARTBEAT_INTERVAL);
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
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers for API endpoints
    if (pathname.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

      // Add to clients
      sseClients.add(res);

      // Remove client on disconnect
      req.on("close", () => {
        sseClients.delete(res);
      });

      return;
    }

    // Serve static files from dist directory (built React app)
    if (pathname === "/" || pathname === "/index.html") {
      serveStatic(res, path.join(__dirname, "dist", "index.html"));
    } else if (pathname.startsWith("/assets/")) {
      // Serve assets from dist/assets
      const assetPath = pathname.substring(1); // Remove leading slash
      serveStatic(res, path.join(__dirname, "dist", assetPath));
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

    sseClients.forEach((client) => client.end());
    sseClients.clear();

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
  sseClients,
  initializeWatcher,
  state,
};

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
