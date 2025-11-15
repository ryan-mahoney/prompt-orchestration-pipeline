/**
 * Centralized logging utility for the prompt orchestration pipeline
 *
 * Provides consistent, structured, and context-aware logging across all core files
 * with SSE integration capabilities and multiple log levels.
 */

// Lazy import SSE registry to avoid circular dependencies
let sseRegistry = null;
async function getSSERegistry() {
  if (!sseRegistry) {
    try {
      const module = await import("../ui/sse.js");
      sseRegistry = module.sseRegistry;
    } catch (error) {
      // SSE not available in all environments
      return null;
    }
  }
  return sseRegistry;
}

/**
 * Creates a logger instance with component name and optional context
 *
 * @param {string} componentName - Name of the component (e.g., 'Orchestrator', 'TaskRunner')
 * @param {Object} context - Optional context object (e.g., { jobId, taskName })
 * @returns {Object} Logger instance with methods for different log levels
 */
export function createLogger(componentName, context = {}) {
  // Build context string for log prefixes
  const contextParts = [];
  if (context.jobId) contextParts.push(context.jobId);
  if (context.taskName) contextParts.push(context.taskName);
  if (context.stage) contextParts.push(context.stage);

  const contextString =
    contextParts.length > 0 ? `|${contextParts.join("|")}` : "";
  const prefix = `[${componentName}${contextString}]`;

  /**
   * Formats data for consistent JSON output
   * @param {*} data - Data to format
   * @returns {string|null} Formatted JSON string or null if data is null/undefined
   */
  function formatData(data) {
    if (data === null || data === undefined) {
      return null;
    }
    if (typeof data === "object") {
      try {
        return JSON.stringify(data, null, 2);
      } catch (error) {
        return `{ "serialization_error": "${error.message}" }`;
      }
    }
    return data;
  }

  /**
   * Broadcasts SSE event if registry is available
   * @param {string} eventType - Type of SSE event
   * @param {*} eventData - Data to broadcast
   */
  async function broadcastSSE(eventType, eventData) {
    const registry = await getSSERegistry().catch(() => null);
    if (registry) {
      try {
        const payload = {
          type: eventType,
          data: eventData,
          component: componentName,
          timestamp: new Date().toISOString(),
          ...context,
        };
        registry.broadcast(payload);
      } catch (error) {
        // Don't fail logging if SSE broadcast fails
        console.warn(
          `${prefix} Failed to broadcast SSE event: ${error.message}`
        );
      }
    }
  }

  return {
    /**
     * Debug level logging
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    debug: (message, data = null) => {
      if (process.env.NODE_ENV !== "production" || process.env.DEBUG) {
        console.debug(`${prefix} ${message}`, formatData(data) || "");
      }
    },

    /**
     * Info level logging
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    log: (message, data = null) => {
      console.log(`${prefix} ${message}`, formatData(data) || "");
    },

    /**
     * Warning level logging
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    warn: (message, data = null) => {
      console.warn(`${prefix} ${message}`, formatData(data) || "");
    },

    /**
     * Error level logging with enhanced error context
     * @param {string} message - Log message
     * @param {*} data - Optional data to log
     */
    error: (message, data = null) => {
      let enhancedData = data;

      // Enhance error objects with additional context
      if (data && data instanceof Error) {
        enhancedData = {
          name: data.name,
          message: data.message,
          stack: data.stack,
          component: componentName,
          timestamp: new Date().toISOString(),
          ...context,
        };
      } else if (
        data &&
        typeof data === "object" &&
        data.error instanceof Error
      ) {
        enhancedData = {
          ...data,
          error: {
            name: data.error.name,
            message: data.error.message,
            stack: data.error.stack,
          },
          component: componentName,
          timestamp: new Date().toISOString(),
          ...context,
        };
      }

      console.error(`${prefix} ${message}`, formatData(enhancedData) || "");
    },

    /**
     * Console group management
     * @param {string} label - Group label
     */
    group: (label) => console.group(`${prefix} ${label}`),

    /**
     * End console group
     */
    groupEnd: () => console.groupEnd(),

    /**
     * SSE event broadcasting
     * @param {string} eventType - Type of SSE event
     * @param {*} eventData - Data to broadcast
     */
    sse: async (eventType, eventData) => {
      // Log SSE broadcast with styling for visibility
      console.log(
        `%c${prefix} SSE Broadcast: ${eventType}`,
        "color: #cc6600; font-weight: bold;",
        formatData(eventData) || ""
      );

      await broadcastSSE(eventType, eventData);
    },
  };
}

/**
 * Creates a logger with job context (convenience function)
 * @param {string} componentName - Component name
 * @param {string} jobId - Job ID
 * @param {Object} additionalContext - Additional context
 * @returns {Object} Logger instance with job context
 */
export function createJobLogger(componentName, jobId, additionalContext = {}) {
  return createLogger(componentName, { jobId, ...additionalContext });
}

/**
 * Creates a logger with task context (convenience function)
 * @param {string} componentName - Component name
 * @param {string} jobId - Job ID
 * @param {string} taskName - Task name
 * @param {Object} additionalContext - Additional context
 * @returns {Object} Logger instance with task context
 */
export function createTaskLogger(
  componentName,
  jobId,
  taskName,
  additionalContext = {}
) {
  return createLogger(componentName, { jobId, taskName, ...additionalContext });
}
