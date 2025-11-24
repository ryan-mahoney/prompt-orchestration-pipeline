/**
 * Static Lifecycle Policy - Pure decision engine for task transitions
 *
 * This module implements centralized lifecycle rules without configuration
 * or runtime toggles, following the principle of explicit failure.
 */

/**
 * Decide if a task transition is allowed based on static lifecycle rules
 * @param {Object} params - Decision parameters
 * @param {string} params.op - Operation: "start" | "restart"
 * @param {string} params.taskState - Current task state
 * @param {boolean} params.dependenciesReady - Whether all upstream dependencies are satisfied
 * @returns {Object} Decision result - { ok: true } | { ok: false, code: "unsupported_lifecycle", reason: "dependencies"|"policy" }
 */
export function decideTransition({ op, taskState, dependenciesReady }) {
  // Validate inputs early - let it crash on invalid data
  if (typeof op !== "string" || !["start", "restart"].includes(op)) {
    throw new Error(`Invalid operation: ${op}. Must be "start" or "restart"`);
  }

  if (typeof taskState !== "string") {
    throw new Error(`Invalid taskState: ${taskState}. Must be a string`);
  }

  if (typeof dependenciesReady !== "boolean") {
    throw new Error(
      `Invalid dependenciesReady: ${dependenciesReady}. Must be boolean`
    );
  }

  // Handle start operation
  if (op === "start") {
    if (!dependenciesReady) {
      return Object.freeze({
        ok: false,
        code: "unsupported_lifecycle",
        reason: "dependencies",
      });
    }
    return Object.freeze({ ok: true });
  }

  // Handle restart operation
  if (op === "restart") {
    if (taskState === "completed") {
      return Object.freeze({ ok: true });
    }
    return Object.freeze({
      ok: false,
      code: "unsupported_lifecycle",
      reason: "policy",
    });
  }

  // This should never be reached due to input validation
  return Object.freeze({
    ok: false,
    code: "unsupported_lifecycle",
    reason: "policy",
  });
}
