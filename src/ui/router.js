/**
 * HTTP request router for the prompt orchestration pipeline UI server
 * Routes requests to appropriate endpoint handlers
 */

import { sseRegistry } from "./sse.js";
import * as state from "./state.js";
import { handleSeedUpload } from "./endpoints/upload-endpoints.js";
import {
  handleTaskFileListRequest,
  handleTaskFileRequest,
} from "./endpoints/file-endpoints.js";
import {
  handleJobRescan,
  handleJobRestart,
} from "./endpoints/job-control-endpoints.js";
import { handleJobList, handleJobDetail } from "./endpoints/job-endpoints.js";
import { handleStaticRequest } from "./endpoints/static-endpoints.js";
import { sendJson } from "./utils/http-utils.js";

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
    console.debug("[Router] Broadcasting state update:", {
      latest,
      currentState,
    });
    if (latest) {
      // Emit only the most recent change as a compact, typed event
      const eventData = { type: "state:change", data: latest };
      console.debug("[Router] Broadcasting event:", eventData);
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
      console.debug("[Router] Broadcasting summary event:", eventData);
      sseRegistry.broadcast(eventData);
    }
  } catch (err) {
    // Defensive: if something unexpected happens, fall back to a lightweight notification
    try {
      console.error("[Router] Error in broadcastStateUpdate:", err);
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
 * Handle GET /api/state endpoint
 */
async function handleApiState(req, res) {
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
      console.warn("Warning: failed to retrieve in-memory state:", innerErr);
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
        statusTransformerModule && statusTransformerModule.transformMultipleJobs
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
}

/**
 * Handle GET /api/events (SSE) endpoint
 */
function handleSseEvents(req, res, pathname, searchParams) {
  if (
    !(
      (pathname === "/api/events" || pathname === "/api/sse") &&
      req.method === "GET"
    )
  ) {
    return false; // Not handled
  }

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

  return true; // Handled
}

/**
 * Handle POST /api/upload/seed endpoint
 */
async function handleUploadSeed(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      error: "Method not allowed",
      allowed: ["POST"],
    });
  }

  // Use the handleSeedUpload function which properly parses multipart data
  await handleSeedUpload(req, res);
  return true; // Handled
}

/**
 * Handle GET /api/jobs/:jobId/tasks/:taskId/files endpoint
 */
async function handleTaskFilesList(req, res, pathname, searchParams, dataDir) {
  if (
    !(
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/files") &&
      req.method === "GET"
    )
  ) {
    return false; // Not handled
  }

  const pathMatch = pathname.match(
    /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/files$/
  );
  if (!pathMatch) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "Invalid path format",
    });
    return true; // Handled (with error)
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
    return true; // Handled (with error)
  }

  if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "taskId is required",
    });
    return true; // Handled (with error)
  }

  if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "type must be one of: artifacts, logs, tmp",
    });
    return true; // Handled (with error)
  }

  try {
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

  return true; // Handled
}

/**
 * Handle GET /api/jobs/:jobId/tasks/:taskId/file endpoint
 */
async function handleTaskFile(req, res, pathname, searchParams, dataDir) {
  if (
    !(
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/file") &&
      req.method === "GET"
    )
  ) {
    return false; // Not handled
  }

  const pathMatch = pathname.match(
    /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/file$/
  );
  if (!pathMatch) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "Invalid path format",
    });
    return true; // Handled (with error)
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
    return true; // Handled (with error)
  }

  if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "taskId is required",
    });
    return true; // Handled (with error)
  }

  if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "type must be one of: artifacts, logs, tmp",
    });
    return true; // Handled (with error)
  }

  if (!filename || typeof filename !== "string" || filename.trim() === "") {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "filename is required",
    });
    return true; // Handled (with error)
  }

  try {
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

  return true; // Handled
}

/**
 * Handle GET /api/jobs endpoint
 */
async function handleJobListRequest(req, res) {
  if (!(req.method === "GET" && req.url === "/api/jobs")) {
    return false; // Not handled
  }

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

  return true; // Handled
}

/**
 * Handle GET /api/llm/functions endpoint
 */
async function handleLlmFunctions(req, res) {
  if (!(req.method === "GET" && req.url === "/api/llm/functions")) {
    return false; // Not handled
  }

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

  return true; // Handled
}

/**
 * Handle POST /api/jobs/:jobId/rescan endpoint
 */
async function handleJobRescanRequest(req, res, pathname, dataDir) {
  if (
    !(
      pathname.startsWith("/api/jobs/") &&
      pathname.endsWith("/rescan") &&
      req.method === "POST"
    )
  ) {
    return false; // Not handled
  }

  const pathMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/rescan$/);
  if (!pathMatch) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "Invalid path format",
    });
    return true; // Handled (with error)
  }

  const [, jobId] = pathMatch;

  await handleJobRescan(req, res, jobId, dataDir, sendJson);
  return true; // Handled
}

/**
 * Handle POST /api/jobs/:jobId/restart endpoint
 */
async function handleJobRestartRequest(req, res, pathname, dataDir) {
  if (
    !(
      pathname.startsWith("/api/jobs/") &&
      pathname.endsWith("/restart") &&
      req.method === "POST"
    )
  ) {
    return false; // Not handled
  }

  const pathMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/restart$/);
  if (!pathMatch) {
    sendJson(res, 400, {
      ok: false,
      error: "bad_request",
      message: "Invalid path format",
    });
    return true; // Handled (with error)
  }

  const [, jobId] = pathMatch;

  await handleJobRestart(req, res, jobId, dataDir, sendJson);
  return true; // Handled
}

/**
 * Handle GET /api/jobs/:jobId endpoint
 */
async function handleJobDetailRequest(req, res, pathname) {
  if (
    !(
      pathname.startsWith("/api/jobs/") &&
      req.method === "GET" &&
      !pathname.includes("/tasks/") &&
      !pathname.endsWith("/rescan") &&
      !pathname.endsWith("/restart")
    )
  ) {
    return false; // Not handled
  }

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

  return true; // Handled
}

/**
 * Handle GET /favicon.svg endpoint
 */
async function handleFavicon(req, res) {
  if (!(req.method === "GET" && req.url === "/favicon.svg")) {
    return false; // Not handled
  }

  const path = await import("path");
  const fs = await import("fs");
  const { fileURLToPath } = await import("url");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

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

  return true; // Handled
}

/**
 * Handle unknown API endpoints
 */
function handleUnknownApi(req, res, pathname) {
  if (!pathname.startsWith("/api/")) {
    return false; // Not handled
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      success: false,
      error: "Not found",
      path: pathname,
      method: req.method,
    })
  );

  return true; // Handled
}

/**
 * Main request routing function
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Object} viteServer - Vite dev server instance (optional)
 * @param {string} dataDir - Base data directory for pipeline data
 */
export function routeRequest(req, res, viteServer, dataDir) {
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
    handleApiState(req, res);
    return;
  }

  // Route: GET /api/events (SSE)
  if (handleSseEvents(req, res, pathname, searchParams)) {
    return;
  }

  // Route: POST /api/upload/seed
  if (pathname === "/api/upload/seed") {
    handleUploadSeed(req, res);
    return;
  }

  // Route: GET /api/jobs/:jobId/tasks/:taskId/files (must come before generic /api/jobs/:jobId)
  if (handleTaskFilesList(req, res, pathname, searchParams, dataDir)) {
    return;
  }

  // Route: GET /api/jobs/:jobId/tasks/:taskId/file (must come before generic /api/jobs/:jobId)
  if (handleTaskFile(req, res, pathname, searchParams, dataDir)) {
    return;
  }

  // Route: GET /api/jobs
  if (handleJobListRequest(req, res)) {
    return;
  }

  // Route: GET /api/llm/functions
  if (handleLlmFunctions(req, res)) {
    return;
  }

  // Route: POST /api/jobs/:jobId/rescan
  if (handleJobRescanRequest(req, res, pathname, dataDir)) {
    return;
  }

  // Route: POST /api/jobs/:jobId/restart
  if (handleJobRestartRequest(req, res, pathname, dataDir)) {
    return;
  }

  // Route: GET /api/jobs/:jobId
  if (handleJobDetailRequest(req, res, pathname)) {
    return;
  }

  // Route: GET /favicon.svg
  if (handleFavicon(req, res)) {
    return;
  }

  // Unknown API endpoint fallback (keep API responses in JSON)
  if (handleUnknownApi(req, res, pathname)) {
    return;
  }

  // Handle static file requests with Vite middleware fallback
  handleStaticRequest(req, res, viteServer, pathname);
}

// Export broadcastStateUpdate for use in server.js
export { broadcastStateUpdate };
