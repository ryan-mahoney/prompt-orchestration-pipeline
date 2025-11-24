/**
 * SSE (Server-Sent Events) and state management endpoints
 */

import { sseRegistry } from "../sse.js";
import { sendJson } from "../utils/http-utils.js";

/**
 * Decorate a change object with jobId and lifecycle information
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

/**
 * Prioritize job status changes from a list of changes
 */
function prioritizeJobStatusChange(changes = []) {
  const normalized = changes.map((change) => decorateChangeWithJobId(change));
  const statusChange = normalized.find(
    (change) =>
      typeof change?.path === "string" &&
      /tasks-status\.json$/.test(change.path)
  );
  return statusChange || normalized[0] || null;
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
 * Handle SSE events endpoint (/api/events)
 */
function handleSseEvents(req, res, searchParams) {
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
}

/**
 * Handle API state endpoint (/api/state)
 */
async function handleApiState(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 200, {
      success: false,
      error: "Method not allowed",
      allowed: ["GET"],
    });
    return;
  }

  // Prefer returning in-memory state when available (tests and runtime rely on state.getState()).
  // If in-memory state is available, return it directly; otherwise fall back to
  // building a filesystem-backed snapshot for client bootstrap.
  try {
    // Dynamically import state to avoid circular dependencies
    const state = await import("../state.js");

    try {
      if (state && typeof state.getState === "function") {
        const inMemory = state.getState();
        if (inMemory) {
          sendJson(res, 200, inMemory);
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
      import("../state-snapshot.js"),
      import("../job-scanner.js").catch(() => null),
      import("../job-reader.js").catch(() => null),
      import("../transformers/status-transformer.js").catch(() => null),
      import("../config-bridge.js").catch(() => null),
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

    sendJson(res, 200, snapshot);
  } catch (err) {
    console.error("Failed to build /api/state snapshot:", err);
    sendJson(res, 500, {
      ok: false,
      code: "snapshot_error",
      message: "Failed to build state snapshot",
      details: err && err.message ? err.message : String(err),
    });
  }
}

export { handleSseEvents, handleApiState, broadcastStateUpdate };
