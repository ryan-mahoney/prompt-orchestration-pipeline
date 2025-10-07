import { startOrchestrator as startOrchestratorImpl } from "../../src/core/orchestrator.js";

/**
 * Start orchestrator with temporary data directory for testing
 * @param {Object} options
 * @param {string} options.dataDir - Data directory path
 * @param {boolean} [options.autoStart] - Whether to auto-start the orchestrator
 * @param {Function} [options.spawn] - Spawn function to use (for testing)
 * @returns {Promise<{stop: function}>} Orchestrator instance with stop function
 */
export async function startOrchestrator({ dataDir, autoStart = true, spawn }) {
  const orchestrator = await startOrchestratorImpl({
    dataDir,
    autoStart,
    spawn,
  });
  return orchestrator;
}
