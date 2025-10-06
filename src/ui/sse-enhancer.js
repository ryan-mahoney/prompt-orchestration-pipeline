/**
 * SSE Enhancer for job-specific events
 * Handles debouncing and coalescing of job update events
 */

import { sseRegistry } from "./sse.js";
import { readJob } from "./job-reader.js";

/**
 * Create a job event enhancer for debouncing and coalescing job updates
 * @param {Object} options - Configuration options
 * @param {Function} options.readJobFn - Function to read job data (for testing)
 * @param {Object} options.sseRegistry - SSE registry instance (for testing)
 * @returns {Object} SSE enhancer with handleJobChange and cleanup methods
 */
export function createSSEEnhancer(options = {}) {
  const { readJobFn = readJob, sseRegistry: registry = sseRegistry } = options;
  const pendingUpdates = new Map(); // jobId -> { lastChange, timer }
  const DEBOUNCE_MS = 200; // 200ms debounce window as specified in requirements

  /**
   * Handle a job change and emit debounced job:updated events
   * @param {Object} change - Job change information from job-change-detector
   * @param {string} change.jobId - Job ID
   * @param {string} change.category - Change category (status, task, seed)
   * @param {string} change.filePath - File path that changed
   */
  async function handleJobChange(change) {
    const { jobId, category } = change;

    // Clear existing timer for this job
    if (pendingUpdates.has(jobId)) {
      const { timer } = pendingUpdates.get(jobId);
      clearTimeout(timer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      try {
        // Read current job state
        const jobResult = await readJobFn(jobId);

        if (jobResult.ok) {
          // Emit job:updated event with full job detail
          registry.broadcast({
            type: "job:updated",
            data: jobResult.data,
          });
        } else {
          console.warn(
            `Failed to read job ${jobId} for SSE:`,
            jobResult.message
          );
        }
      } catch (error) {
        console.error(`Error processing job update for ${jobId}:`, error);
      } finally {
        // Clean up pending update
        pendingUpdates.delete(jobId);
      }
    }, DEBOUNCE_MS);

    // Store the pending update
    pendingUpdates.set(jobId, {
      lastChange: Date.now(),
      timer,
      category,
    });
  }

  /**
   * Clean up all pending timers and clear state
   */
  function cleanup() {
    for (const [jobId, { timer }] of pendingUpdates) {
      clearTimeout(timer);
    }
    pendingUpdates.clear();
  }

  /**
   * Get the number of pending job updates
   * @returns {number} Count of pending updates
   */
  function getPendingCount() {
    return pendingUpdates.size;
  }

  return {
    handleJobChange,
    cleanup,
    getPendingCount,
  };
}

// Export a singleton instance for use across the application
export const sseEnhancer = createSSEEnhancer();
