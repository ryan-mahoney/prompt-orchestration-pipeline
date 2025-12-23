/**
 * Single Node.js server handling static files, API, and SSE
 * Serves UI and provides real-time file change updates
 */

import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnvironment } from "../core/environment.js";
import { start as startWatcher, stop as stopWatcher } from "./watcher.js";
import * as state from "./state.js";
import { sseRegistry } from "./sse.js";
import { resolvePipelinePaths } from "../config/paths.js";
import { broadcastStateUpdate } from "./sse-broadcast.js";
import { buildExpressApp } from "./express-app.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vite dev server instance (populated in development mode)
let viteServer = null;

// Configuration
const PORT = process.env.PORT || 4000;
const WATCHED_PATHS = (
  process.env.WATCHED_PATHS ||
  (process.env.NODE_ENV === "test"
    ? "pipeline-config,runs"
    : "pipeline-config,pipeline-data,runs")
)
  .split(",")
  .map((p) => p.trim());
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DATA_DIR = process.env.PO_ROOT || process.cwd();

let heartbeatTimer = null;

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
 * Create and start an HTTP server
 * @param {string} serverDataDir - Base data directory for pipeline data
 */
function createServer(serverDataDir = DATA_DIR) {
  const app = buildExpressApp({ dataDir: serverDataDir, viteServer });
  const server = http.createServer(app);
  return server;
}

/**
 * Initialize file watcher
 */
let watcher = null;

function initializeWatcher() {
  // Require PO_ROOT for non-test runs
  const base = process.env.PO_ROOT;
  if (!base) {
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "ERROR: PO_ROOT environment variable is required for non-test runs"
      );
      throw new Error(
        "PO_ROOT environment variable is required for non-test runs"
      );
    } else {
      console.warn(
        "WARNING: PO_ROOT not set, using process.cwd() in test mode"
      );
    }
  }

  const effectiveBase = base || process.cwd();

  // Derive paths via resolvePipelinePaths to obtain absolute dirs for pipeline lifecycle directories
  const paths = resolvePipelinePaths(effectiveBase);

  // Build absolute paths array including pipeline-config and all lifecycle directories
  const absolutePaths = [
    path.join(effectiveBase, "pipeline-config"),
    paths.current,
    paths.complete,
    paths.pending,
    paths.rejected,
  ];

  // Log effective configuration
  console.log(`Watching directories under PO_ROOT=${effectiveBase}`);
  console.log("Final absolute paths:", absolutePaths);

  // Keep original WATCHED_PATHS in state for display/tests; watcher receives absolute paths.
  state.setWatchedPaths(WATCHED_PATHS);

  watcher = startWatcher(
    absolutePaths,
    (changes) => {
      // Update state for each change and capture the last returned state.
      // Prefer broadcasting state returned by recordChange (if available)
      // to ensure tests and callers receive an up-to-date snapshot without
      // relying on mocked module-level getState behavior.
      let lastState = null;
      changes.forEach(({ path, type }) => {
        try {
          lastState = state.recordChange(path, type);
        } catch (err) {
          // Don't let a single change handler error prevent broadcasting
        }
      });

      // Broadcast updated state: prefer the result returned by recordChange when available
      broadcastStateUpdate(lastState || state.getState());
    },
    { baseDir: effectiveBase, debounceMs: 200 }
  );
}

/**
 * Start server with configurable data directory and port
 * @param {Object} options - Server options
 * @param {string} options.dataDir - Base data directory for pipeline data
 * @param {number} [options.port] - Optional port (defaults to PORT env var or 4000)
 * @returns {Promise<{url: string, close: function}>} Server instance with URL and close method
 */
async function startServer({ dataDir, port: customPort }) {
  try {
    // Load environment variables from .env file for API keys and other config
    await loadEnvironment();

    // Initialize config-bridge paths early to ensure consistent path resolution
    // This prevents path caching issues when dataDir changes between tests
    const { initPATHS } = await import("./config-bridge.node.js");
    initPATHS(dataDir);

    // Require PO_ROOT for non-test runs
    if (!process.env.PO_ROOT && process.env.NODE_ENV !== "test") {
      console.error(
        "ERROR: PO_ROOT environment variable is required for non-test runs"
      );
      throw new Error(
        "PO_ROOT environment variable is required for non-test runs"
      );
    } else if (!process.env.PO_ROOT) {
      console.warn(
        "WARNING: PO_ROOT not set, using process.cwd() in test mode"
      );
    }

    // Use customPort if provided, otherwise use PORT env var, otherwise use default PORT constant
    const port =
      customPort !== undefined
        ? customPort
        : process.env.PORT
          ? parseInt(process.env.PORT)
          : PORT;

    // In development, start Vite in middlewareMode so that Node server can serve
    // client with HMR in a single process. We dynamically import Vite here
    // to avoid including it in production bundles.
    // Skip Vite entirely for API-only tests when DISABLE_VITE=1 is set.
    // Do not start Vite in tests to avoid dep-scan errors during teardown.
    if (
      process.env.NODE_ENV === "development" &&
      process.env.DISABLE_VITE !== "1"
    ) {
      try {
        // Import createServer under an alias to avoid collision with our createServer()
        const { createServer: createViteServer } = await import("vite");
        viteServer = await createViteServer({
          root: path.join(__dirname, "client"),
          server: { middlewareMode: true },
          appType: "custom",
        });
      } catch (err) {
        console.error("Failed to start Vite dev server:", err);
        viteServer = null;
      }
    }

    const server = createServer(dataDir);

    // Robust promise with proper error handling and race condition prevention
    await new Promise((resolve, reject) => {
      let settled = false;

      const errorHandler = (error) => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);

          // Enhance error with structured information for better test assertions
          if (error.code === "EADDRINUSE") {
            error.message = `Port ${port} is already in use`;
            error.port = port;
          }

          console.error(`Server error on port ${port}:`, error);
          reject(error);
        }
      };

      const successHandler = () => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);
          resolve();
        }
      };

      // Attach error handler BEFORE attempting to listen
      server.on("error", errorHandler);

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);
          reject(new Error(`Server startup timeout on port ${port}`));
        }
      }, 5000); // 5 second timeout

      server.listen(port, () => {
        clearTimeout(timeout);
        successHandler();
      });
    });

    const address = server.address();
    const baseUrl = `http://localhost:${address.port}`;

    // Only initialize watcher and heartbeat in non-test environments
    if (process.env.NODE_ENV !== "test") {
      initializeWatcher();
      startHeartbeat();
    }

    return {
      url: baseUrl,
      close: async () => {
        console.log("[Server] Starting server cleanup...");
        // Clean up all resources
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        if (watcher) {
          await stopWatcher(watcher);
          watcher = null;
        }

        sseRegistry.closeAll();

        // Close Vite dev server if running (development single-process mode)
        if (viteServer && typeof viteServer.close === "function") {
          try {
            await viteServer.close();
            viteServer = null;
          } catch (err) {
            console.error("Error closing Vite dev server:", err);
          }
        }

        console.log("[Server] Closing HTTP server...");
        // Close HTTP server
        return new Promise((resolve) => {
          server.close(() => {
            console.log("[Server] HTTP server closed");
            resolve();
          });
        });
      },
    };
  } catch (error) {
    console.error("Failed to start server:", error);
    throw error; // Re-throw so tests can handle it
  }
}

// Export for testing
export {
  createServer,
  startServer,
  broadcastStateUpdate,
  sseRegistry,
  initializeWatcher,
  state,
};

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ dataDir: DATA_DIR }).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
