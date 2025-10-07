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
  const clients = new Set(); // Set<http.ServerResponse | {write:Function, end?:Function, on?:Function}>
  let heartbeatTimer = null;

  function _startHeartbeat() {
    if (!heartbeatMs || heartbeatTimer) return;
    heartbeatTimer = nodeSetInterval(() => {
      for (const res of clients) {
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
          clients.delete(res);
        }
      }
    }, heartbeatMs);
  }

  /**
   * Add a client response to the registry and send headers if possible.
   * Accepts real http.ServerResponse or a test mock {write(), [writeHead], [end], [on]}.
   * @param {any} res
   */
  function addClient(res) {
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

    clients.add(res);
    _startHeartbeat();

    if (res && typeof res.on === "function") {
      res.on("close", () => {
        clients.delete(res);
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
    if (!clients.has(res)) return;
    try {
      typeof res.end === "function" && res.end();
    } catch {}
    clients.delete(res);
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

    for (const res of clients) {
      try {
        if (typeof res.write !== "function") {
          dead.push(res);
          continue;
        }
        if (type) {
          res.write(`event: ${type}\n`);
        }
        res.write(`data: ${payload}\n\n`);
      } catch {
        dead.push(res);
      }
    }

    // Clean up dead clients
    for (const res of dead) {
      try {
        typeof res.end === "function" && res.end();
      } catch {}
      clients.delete(res);
    }
  }

  function getClientCount() {
    return clients.size;
  }

  function closeAll() {
    for (const res of clients) {
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
