/**
 * Single Node.js server handling static files, API, and SSE
 * Serves UI and provides real-time file change updates
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { start as startWatcher, stop as stopWatcher } from "./watcher.js";
import * as state from "./state.js";
// Import orchestrator-related functions only in non-test mode
let submitJobWithValidation;
import { sseRegistry } from "./sse.js";
import {
  resetJobToCleanSlate,
  initializeJobArtifacts,
  writeJobStatus,
} from "../core/status-writer.js";
import { getPipelineConfig } from "../core/config.js";
import { spawn } from "node:child_process";
import {
  getPendingSeedPath,
  resolvePipelinePaths,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
} from "../config/paths.js";
import { handleJobList, handleJobDetail } from "./endpoints/job-endpoints.js";
import { generateJobId } from "../utils/id-generator.js";
import { getMimeType, isTextMime } from "./utils/mime-types.js";
import {
  sendJson,
  readRawBody,
  parseMultipartFormData,
} from "./utils/http-utils.js";
import {
  handleSeedUpload,
  normalizeSeedUpload,
  handleSeedUploadDirect,
} from "./endpoints/upload-endpoints.js";
import {
  handleTaskFileListRequest,
  handleTaskFileRequest,
  validateFilePath,
} from "./endpoints/file-endpoints.js";
import {
  handleJobRescan,
  handleJobRestart,
} from "./endpoints/job-control-endpoints.js";
import { handleStaticRequest } from "./endpoints/static-endpoints.js";

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

const exists = async (p) =>
  fs.promises
    .access(p)
    .then(() => true)
    .catch(() => false);

function extractJsonFromMultipart(raw, contentType) {
  const m = /boundary=([^;]+)/i.exec(contentType || "");
  if (!m) throw new Error("Missing multipart boundary");
  const boundary = `--${m[1]}`;
  const parts = raw.toString("utf8").split(boundary);
  const filePart = parts.find((p) => /name="file"/i.test(p));
  if (!filePart) throw new Error("Missing file part");
  const [, , body] = filePart.split(/\r\n\r\n/);
  if (!body) throw new Error("Empty file part");
  // strip trailing CRLF + terminating dashes
  return body.replace(/\r\n--\s*$/, "").trim();
}

/**
 * Broadcast state update to all SSE clients
 *
 * NOTE: Per plan, SSE should emit compact, incremental events rather than
 * streaming full application state. Use /api/state for full snapshot
 * retrieval on client bootstrap. This function will emit only the most
 * recent change when available (type: "state:change") and fall back to a
 * lightweight summary event if no recent change is present.
 */
function decorateChangeWithJobId(change) {
  if (!change || typeof change !== "object") return change;
  const normalizedPath = String(change.path || "").replace(/\\/g, "/");
  const match = normalizedPath.match(
    /pipeline-data\/(current|complete|pending|rejected)\/([^/]+)/
  );
  if (!match) {
    return change;
  }
  return {
    ...change,
    lifecycle: match[1],
    jobId: match[2],
  };
}

function prioritizeJobStatusChange(changes = []) {
  const normalized = changes.map((change) => decorateChangeWithJobId(change));
  const statusChange = normalized.find(
    (change) =>
      typeof change?.path === "string" &&
      /tasks-status\.json$/.test(change.path)
  );
  return statusChange || normalized[0] || null;
}

function broadcastStateUpdate(currentState) {
  try {
    const recentChanges = (currentState && currentState.recentChanges) || [];
    const latest = prioritizeJobStatusChange(recentChanges);
    console.debug("[Server] Broadcasting state update:", {
      latest,
      currentState,
    });
    if (latest) {
      // Emit only the most recent change as a compact, typed event
      const eventData = { type: "state:change", data: latest };
      console.debug("[Server] Broadcasting event:", eventData);
      sseRegistry.broadcast(eventData);
    } else {
      // Fallback: emit a minimal summary so clients can observe a state "tick"
      const eventData = {
        type: "state:summary",
        data: {
          changeCount:
            currentState && currentState.changeCount
              ? currentState.changeCount
              : 0,
        },
      };
      console.debug("[Server] Broadcasting summary event:", eventData);
      sseRegistry.broadcast(eventData);
    }
  } catch (err) {
    // Defensive: if something unexpected happens, fall back to a lightweight notification
    try {
      console.error("[Server] Error in broadcastStateUpdate:", err);
      sseRegistry.broadcast({
        type: "state:summary",
        data: {
          changeCount:
            currentState && currentState.changeCount
              ? currentState.changeCount
              : 0,
        },
      });
    } catch (fallbackErr) {
      // Log error to aid debugging; this should never happen unless sseRegistry.broadcast is broken
      console.error(
        "Failed to broadcast fallback state summary in broadcastStateUpdate:",
        fallbackErr
      );
    }
  }
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
 * Create and start an HTTP server
 * @param {string} serverDataDir - Base data directory for pipeline data
 */
function createServer(serverDataDir = DATA_DIR) {
  const server = http.createServer(async (req, res) => {
    // Use WHATWG URL API instead of deprecated url.parse
    const { pathname, searchParams } = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    // CORS headers for API endpoints
    if (pathname.startsWith("/api/")) {
      // Important for tests: avoid idle keep-alive sockets on short API calls
      res.setHeader("Connection", "close");
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
    if (pathname === "/api/state") {
      if (req.method !== "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Method not allowed",
            allowed: ["GET"],
          })
        );
        return;
      }

      // Prefer returning in-memory state when available (tests and runtime rely on state.getState()).
      // If in-memory state is available, return it directly; otherwise fall back to
      // building a filesystem-backed snapshot for client bootstrap.
      try {
        try {
          if (state && typeof state.getState === "function") {
            const inMemory = state.getState();
            if (inMemory) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(inMemory));
              return;
            }
          }
        } catch (innerErr) {
          // If reading in-memory state throws for some reason, fall back to snapshot
          console.warn(
            "Warning: failed to retrieve in-memory state:",
            innerErr
          );
        }

        // Build a filesystem-backed snapshot for client bootstrap.
        // Dynamically import the composer and dependencies to avoid circular import issues.
        const [
          { buildSnapshotFromFilesystem },
          jobScannerModule,
          jobReaderModule,
          statusTransformerModule,
          configBridgeModule,
        ] = await Promise.all([
          import("./state-snapshot.js"),
          import("./job-scanner.js").catch(() => null),
          import("./job-reader.js").catch(() => null),
          import("./transformers/status-transformer.js").catch(() => null),
          import("./config-bridge.js").catch(() => null),
        ]);

        const snapshot = await buildSnapshotFromFilesystem({
          listAllJobs:
            jobScannerModule && jobScannerModule.listAllJobs
              ? jobScannerModule.listAllJobs
              : undefined,
          readJob:
            jobReaderModule && jobReaderModule.readJob
              ? jobReaderModule.readJob
              : undefined,
          transformMultipleJobs:
            statusTransformerModule &&
            statusTransformerModule.transformMultipleJobs
              ? statusTransformerModule.transformMultipleJobs
              : undefined,
          now: () => new Date(),
          paths: (configBridgeModule && configBridgeModule.PATHS) || undefined,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        console.error("Failed to build /api/state snapshot:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            code: "snapshot_error",
            message: "Failed to build state snapshot",
            details: err && err.message ? err.message : String(err),
          })
        );
      }

      return;
    }

    // Route: GET /api/events (SSE)
    if (
      (pathname === "/api/events" || pathname === "/api/sse") &&
      req.method === "GET"
    ) {
      // Parse jobId from query parameters for filtering
      const jobId = searchParams.get("jobId");

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Flush headers immediately
      res.flushHeaders();

      // Initial full-state is no longer sent over the SSE stream.
      // Clients should fetch the snapshot from GET /api/state during bootstrap
      // and then rely on SSE incremental events (state:change/state:summary).
      // Keep headers flushed; sseRegistry.addClient will optionally send an initial ping.
      // (Previously sent full state here; removed to reduce SSE payloads.)

      // Add to SSE registry with jobId metadata for filtering
      sseRegistry.addClient(res, { jobId });

      // Start heartbeat for this connection
      const heartbeatInterval = setInterval(() => {
        try {
          res.write(
            `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
          );
        } catch (err) {
          // Client disconnected, stop heartbeat
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Remove client on disconnect
      req.on("close", () => {
        clearInterval(heartbeatInterval);
        sseRegistry.removeClient(res);
      });

      return;
    }

    // Route: POST /api/upload/seed
    if (pathname === "/api/upload/seed") {
      if (req.method !== "POST") {
        return sendJson(res, 405, {
          success: false,
          error: "Method not allowed",
          allowed: ["POST"],
        });
      }

      // Use the handleSeedUpload function which properly parses multipart data
      await handleSeedUpload(req, res);
      return;
    }

    // Route: GET /api/jobs/:jobId/tasks/:taskId/files (must come before generic /api/jobs/:jobId)
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/files") &&
      req.method === "GET"
    ) {
      const pathMatch = pathname.match(
        /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/files$/
      );
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId, taskId] = pathMatch;
      const type = searchParams.get("type");

      // Validate parameters
      if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "jobId is required",
        });
        return;
      }

      if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "taskId is required",
        });
        return;
      }

      if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "type must be one of: artifacts, logs, tmp",
        });
        return;
      }

      try {
        const dataDir = process.env.PO_ROOT || DATA_DIR;
        await handleTaskFileListRequest(req, res, {
          jobId,
          taskId,
          type,
          dataDir,
        });
      } catch (error) {
        console.error(`Error handling task file list request:`, error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/jobs/:jobId/tasks/:taskId/file (must come before generic /api/jobs/:jobId)
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/file") &&
      req.method === "GET"
    ) {
      const pathMatch = pathname.match(
        /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/file$/
      );
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId, taskId] = pathMatch;
      const type = searchParams.get("type");
      const filename = searchParams.get("filename");

      // Validate parameters
      if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "jobId is required",
        });
        return;
      }

      if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "taskId is required",
        });
        return;
      }

      if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "type must be one of: artifacts, logs, tmp",
        });
        return;
      }

      if (!filename || typeof filename !== "string" || filename.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "filename is required",
        });
        return;
      }

      try {
        const dataDir = process.env.PO_ROOT || DATA_DIR;
        await handleTaskFileRequest(req, res, {
          jobId,
          taskId,
          type,
          filename,
          dataDir,
        });
      } catch (error) {
        console.error(`Error handling task file request:`, error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/jobs
    if (pathname === "/api/jobs" && req.method === "GET") {
      try {
        const result = await handleJobList();

        if (result.ok) {
          sendJson(res, 200, result.data);
        } else {
          sendJson(res, 500, result);
        }
      } catch (error) {
        console.error("Error handling /api/jobs:", error);
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/llm/functions
    if (pathname === "/api/llm/functions" && req.method === "GET") {
      try {
        const { PROVIDER_FUNCTIONS } = await import("../config/models.js");

        sendJson(res, 200, PROVIDER_FUNCTIONS);
      } catch (error) {
        console.error("Error handling /api/llm/functions:", error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Failed to get LLM functions",
        });
      }
      return;
    }

    // Route: POST /api/jobs/:jobId/rescan
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.endsWith("/rescan") &&
      req.method === "POST"
    ) {
      const pathMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/rescan$/);
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId] = pathMatch;
      // Use dataDir that was passed to startServer, not environment variable
      // This ensures tests use their temporary directories correctly
      const dataDir = serverDataDir;

      await handleJobRescan(req, res, jobId, dataDir, sendJson);
      return;
    }

    // Route: POST /api/jobs/:jobId/restart
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.endsWith("/restart") &&
      req.method === "POST"
    ) {
      const pathMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/restart$/);
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId] = pathMatch;
      // Use dataDir that was passed to startServer, not environment variable
      // This ensures tests use their temporary directories correctly
      const dataDir = serverDataDir;

      await handleJobRestart(req, res, jobId, dataDir, sendJson);
      return;
    }

    // Route: GET /api/jobs/:jobId
    if (pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const jobId = pathname.substring("/api/jobs/".length);

      try {
        const result = await handleJobDetail(jobId);

        if (result.ok) {
          sendJson(res, 200, result);
        } else {
          switch (result.code) {
            case "job_not_found":
              sendJson(res, 404, result);
              break;
            case "bad_request":
              sendJson(res, 400, result);
              break;
            default:
              sendJson(res, 500, result);
          }
        }
      } catch (error) {
        console.error(`Error handling /api/jobs/${jobId}:`, error);
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /favicon.svg
    if (pathname === "/favicon.svg" && req.method === "GET") {
      const faviconPath = path.join(__dirname, "public", "favicon.svg");

      try {
        const content = await fs.promises.readFile(faviconPath, "utf8");
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        });
        res.end(content);
      } catch (error) {
        console.error("Error serving favicon:", error);
        res.writeHead(404);
        res.end("Favicon not found");
      }
      return;
    }

    // Unknown API endpoint fallback (keep API responses in JSON)
    if (pathname.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not found",
          path: pathname,
          method: req.method,
        })
      );
      return;
    }

    // Handle static file requests with Vite middleware fallback
    return handleStaticRequest(req, res, viteServer, pathname);
  });

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
    // Initialize config-bridge paths early to ensure consistent path resolution
    // This prevents path caching issues when dataDir changes between tests
    const { initPATHS } = await import("./config-bridge.node.js");
    initPATHS(dataDir);

    // Require PO_ROOT for non-test runs
    if (!process.env.PO_ROOT) {
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
        // Don't override PO_ROOT in test mode - let tests use their temp dirs
      }
    }

    // Use customPort if provided, otherwise use PORT env var, otherwise use 0 for ephemeral port
    const port =
      customPort !== undefined
        ? customPort
        : process.env.PORT
          ? parseInt(process.env.PORT)
          : 0;

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

        // Close HTTP server
        return new Promise((resolve) => server.close(resolve));
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
  startServer({ dataDir: DATA_DIR });
}
