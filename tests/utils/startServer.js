import { startServer as startServerImpl } from "../../src/ui/server.js";

/**
 * Start server with temporary data directory for testing
 * @param {Object} options
 * @param {string} options.dataDir - Data directory path
 * @param {number} [options.port] - Port to use (default: 0 for auto-assigned)
 * @returns {Promise<{url: string, close: function}>} Server instance with URL and close function
 */
export async function startServer({ dataDir, port = 0 }) {
  const server = await startServerImpl({ dataDir, port });
  return server;
}
