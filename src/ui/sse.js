/**
 * Server-Sent Events (SSE) registry for broadcasting to connected clients.
 * Compatibility-focused: tolerant of mock clients, supports typed & untyped
 * broadcasts, dead-client cleanup, optional heartbeats, and optional initial ping.
 */

import {
  setInterval as nodeSetInterval,
  clearInterval as nodeClearInterval,
} from "node:timers";

/**
 * Create an SSE registry.
 * @param {{ heartbeatMs?: number, sendInitialPing?: boolean }} [opts]
 *   - heartbeatMs: send periodic keep-alive comments (default 15000)
 *   - sendInitialPing: write ': connected\n\n' on addClient (default false)
 */
export function createSSERegistry({
  heartbeatMs = 15000,
  sendInitialPing = false,
} = {}) {
  const clients = new Set(); // Set<{res: http.ServerResponse | {write:Function, end?:Function, on?:Function}, jobId?: string}>
  let heartbeatTimer = null;

  function _startHeartbeat() {
    if (!heartbeatMs || heartbeatTimer) return;
    heartbeatTimer = nodeSetInterval(() => {
      for (const client of clients) {
        const res = client.res || client;
        try {
          if (typeof res.write === "function") {
            // Comment line per SSE spec; keeps proxies from buffering/closing.
            res.write(`: keep-alive\n\n`);
          }
        } catch {
          // Will be cleaned on next broadcast or below
          try {
            typeof res.end === "function" && res.end();
          } catch {}
          clients.delete(client);
        }
      }
    }, heartbeatMs);
  }

  /**
   * Add a client response to the registry and send headers if possible.
   * Accepts real http.ServerResponse or a test mock {write(), [writeHead], [end], [on]}.
   * @param {any} res
   * @param {Object} [metadata] - Optional metadata for the client (e.g., { jobId })
   */
  function addClient(res, metadata = {}) {
    const client = { res, ...metadata };

    try {
      if (typeof res.writeHead === "function") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no", // helps with nginx buffering
        });
      }
      if (sendInitialPing && typeof res.write === "function") {
        // Initial ping so EventSource 'open' resolves quickly (server mode)
        res.write(`: connected\n\n`);
      }
    } catch {
      // If headers or initial write fail, avoid crashing tests—still register client
    }

    clients.add(client);
    _startHeartbeat();

    if (res && typeof res.on === "function") {
      res.on("close", () => {
        clients.delete(client);
        if (clients.size === 0 && heartbeatTimer) {
          nodeClearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      });
    }
  }

  /**
   * Remove a client (and end its response if possible).
   * @param {any} res
   */
  function removeClient(res) {
    // Find client by response object (handle both old and new structure)
    let clientToRemove = null;
    for (const client of clients) {
      const clientRes = client.res || client;
      if (clientRes === res) {
        clientToRemove = client;
        break;
      }
    }

    if (!clientToRemove) return;

    const clientRes = clientToRemove.res || clientToRemove;
    try {
      typeof clientRes.end === "function" && clientRes.end();
    } catch {}
    clients.delete(clientToRemove);
    if (clients.size === 0 && heartbeatTimer) {
      nodeClearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /**
   * Broadcast SSE. Supports:
   *  - broadcast({ type, data })
   *  - broadcast("eventName", data)
   *  - broadcast(data)  // untyped 'message' event (data-only)
   */
  function broadcast(arg1, arg2) {
    /** @type {string | undefined} */
    let type;
    /** @type {any} */
    let data;

    if (typeof arg1 === "string") {
      type = arg1;
      data = arg2;
    } else if (
      arg1 &&
      typeof arg1 === "object" &&
      ("type" in arg1 || "data" in arg1)
    ) {
      type = arg1.type;
      data = arg1.data;
    } else {
      type = undefined;
      data = arg1;
    }

    const payload =
      typeof data === "string" ? data : JSON.stringify(data ?? {});
    const dead = [];

    for (const client of clients) {
      const res = client.res || client;

      // Apply jobId filtering: if data has a jobId and client has a jobId, only send if they match
      if (data && data.jobId && client.jobId) {
        if (data.jobId !== client.jobId) {
          continue; // Skip this client - event is for a different job
        }
      }

      try {
        if (typeof res.write !== "function") {
          dead.push(client);
          continue;
        }
        if (type) {
          res.write(`event: ${type}\n`);
        }
        res.write(`data: ${payload}\n\n`);
      } catch {
        dead.push(client);
      }
    }

    // Clean up dead clients
    for (const client of dead) {
      const clientRes = client.res || client;
      try {
        typeof clientRes.end === "function" && clientRes.end();
      } catch {}
      clients.delete(client);
    }
  }

  function getClientCount() {
    return clients.size;
  }

  function closeAll() {
    for (const client of clients) {
      const res = client.res || client;
      try {
        typeof res.end === "function" && res.end();
      } catch {}
    }
    clients.clear();
    if (heartbeatTimer) {
      nodeClearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  return { addClient, removeClient, broadcast, getClientCount, closeAll };
}

// Export a singleton used by the server: keep initial ping enabled for real EventSource clients
export const sseRegistry = createSSERegistry({
  heartbeatMs: 15000,
  sendInitialPing: true,
});
