/**
 * Centralized test server helper for managing server instances and cleanup
 * Provides consistent server startup patterns and prevents resource leaks
 */

import { startServer } from "../../src/ui/server.js";

// Track active servers for cleanup
const activeServers = new Set();

/**
 * Start a test server with enhanced error handling and resource tracking
 * @param {Object} options - Server options
 * @param {string} options.dataDir - Base data directory for pipeline data
 * @param {number} [options.port] - Port to use (default: 0 for auto-assigned)
 * @returns {Promise<{url: string, close: function}>} Server instance with URL and close method
 */
export async function startTestServer({ dataDir, port = 0 } = {}) {
  // Always ensure ephemeral port unless explicitly overridden
  const serverPort = port === 0 ? 0 : port;

  const server = await startServer({ dataDir, port: serverPort });
  activeServers.add(server);

  return {
    ...server,
    close: async () => {
      activeServers.delete(server);
      await server.close();
    },
  };
}

/**
 * Clean up all active servers
 * @returns {Promise<void>}
 */
export async function cleanupAllServers() {
  const cleanupPromises = Array.from(activeServers).map(async (server) => {
    try {
      await server.close();
    } catch (error) {
      console.warn("Error closing server during cleanup:", error.message);
    }
  });

  await Promise.all(cleanupPromises);
  activeServers.clear();
}

/**
 * Get the number of currently active servers
 * @returns {number}
 */
export function getActiveServerCount() {
  return activeServers.size;
}

/**
 * Get information about active servers for debugging
 * @returns {Array<{url: string}>}
 */
export function getActiveServerInfo() {
  return Array.from(activeServers).map((server) => ({
    url: server.url,
  }));
}
