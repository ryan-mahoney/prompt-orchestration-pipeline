/**
 * Server-Sent Events (SSE) registry for broadcasting events to connected clients
 */

/**
 * Create an SSE registry for managing client connections and broadcasting events
 * @returns {Object} SSE registry with addClient, removeClient, and broadcast methods
 */
export function createSSERegistry() {
  const clients = new Set();

  /**
   * Add a client response to the registry
   * @param {http.ServerResponse} res - HTTP response object for SSE connection
   */
  function addClient(res) {
    clients.add(res);
  }

  /**
   * Remove a client response from the registry
   * @param {http.ServerResponse} res - HTTP response object to remove
   */
  function removeClient(res) {
    clients.delete(res);
  }

  /**
   * Broadcast an event to all connected clients
   * @param {Object} event - Event object to broadcast
   * @param {string} event.type - Event type identifier
   * @param {any} event.data - Event data payload
   */
  function broadcast(event) {
    const deadClients = new Set();

    clients.forEach((client) => {
      try {
        client.write(`event: ${event.type}\n`);
        client.write(`data: ${JSON.stringify(event.data)}\n\n`);
      } catch (err) {
        // Mark client for removal if write fails
        deadClients.add(client);
      }
    });

    // Clean up dead connections
    deadClients.forEach((client) => removeClient(client));
  }

  /**
   * Get the number of connected clients
   * @returns {number} Number of connected clients
   */
  function getClientCount() {
    return clients.size;
  }

  /**
   * Close all client connections and clear the registry
   */
  function closeAll() {
    clients.forEach((client) => {
      try {
        client.end();
      } catch (err) {
        // Ignore errors during cleanup
      }
    });
    clients.clear();
  }

  return {
    addClient,
    removeClient,
    broadcast,
    getClientCount,
    closeAll,
  };
}

// Export a singleton instance for use across the application
export const sseRegistry = createSSERegistry();
