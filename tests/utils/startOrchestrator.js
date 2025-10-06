import { startOrchestrator as startOrchestratorImpl } from "../../src/core/orchestrator.js";

/**
 * Start orchestrator with temporary data directory for testing
 * @param {Object} options
 * @param {string} options.dataDir - Data directory path
 * @param {boolean} [options.autoStart] - Whether to auto-start the orchestrator
 * @returns {Promise<{stop: function}>} Orchestrator instance with stop function
 */
export async function startOrchestrator({ dataDir, autoStart = true }) {
  const orchestrator = await startOrchestratorImpl({ dataDir, autoStart });
  return orchestrator;
}
