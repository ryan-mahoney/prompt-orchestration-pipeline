/**
 * Centralized test server helper for managing server instances and cleanup.
 * Maintains original functionality while adding SSE-aware teardown.
 */

import { startServer } from "../../src/ui/server.js";
import { sseRegistry } from "../../src/ui/sse.js";

// Track active servers for cleanup
const activeServers = new Set();

/**
 * Start a test server with consistent return shape and proper cleanup.
 * @param {Object} options
 * @param {string} options.dataDir - Base data directory for pipeline data
 * @param {number} [options.port=0] - Port to use (0 = auto-assign)
 * @returns {Promise<{url:string, close:() => Promise<void>}>}
 */
export async function startTestServer({ dataDir, port = 0 } = {}) {
  const started = await startServer({ dataDir, port });

  let url;
  let close;

  // Create the api object first so cleanup functions can reference it
  const api = { url: "", close: () => Promise.resolve() };

  // Support both shapes: {url, close} or {server, port}
  if (started?.url && typeof started?.close === "function") {
    url = started.url;
    close = async () => {
      try {
        sseRegistry.closeAll();
      } catch {}
      await started.close();
      activeServers.delete(api);
    };
  } else if (started?.server) {
    const p =
      started?.port ??
      started?.server?.address?.()?.port ??
      (typeof port === "number" ? port : 0);

    url = `http://127.0.0.1:${p}`;
    close = async () => {
      try {
        sseRegistry.closeAll();
      } catch {}
      await new Promise((resolve) => started.server.close(resolve));
      activeServers.delete(api);
    };
  } else {
    throw new Error("startServer() returned an unsupported shape");
  }

  // Update the api object with actual values
  api.url = url;
  api.close = close;
  activeServers.add(api);
  return api;
}

/**
 * Number of active servers (for debugging)
 */
export function getActiveServerCount() {
  return activeServers.size;
}

/**
 * Info on active servers (for debugging)
 */
export function getActiveServerInfo() {
  return Array.from(activeServers).map((s) => ({ url: s.url }));
}
