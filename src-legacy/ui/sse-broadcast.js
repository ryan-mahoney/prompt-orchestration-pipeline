/**
 * SSE broadcast module for state updates
 * Extracted from router.js to support Express migration
 */

import { sseRegistry } from "./sse.js";

/**
 * Decorate change with job ID extracted from file path
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
 * Prioritize job status changes over other changes
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
    if (latest) {
      // Emit only the most recent change as a compact, typed event
      const eventData = { type: "state:change", data: latest };
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

export { broadcastStateUpdate };
