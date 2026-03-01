/**
 * In-memory lock for pipeline analysis operations.
 * Ensures only one pipeline can be analyzed at a time.
 */

let currentLock = null;

/**
 * Attempt to acquire the analysis lock for a pipeline.
 * @param {string} pipelineSlug - The pipeline identifier
 * @returns {{ acquired: true } | { acquired: false, heldBy: string }}
 */
export function acquireLock(pipelineSlug) {
  if (!pipelineSlug || typeof pipelineSlug !== "string") {
    throw new Error(
      `Invalid pipelineSlug: expected non-empty string, got ${typeof pipelineSlug}`
    );
  }

  if (currentLock === null) {
    currentLock = {
      pipelineSlug,
      startedAt: new Date(),
    };
    return { acquired: true };
  }

  return {
    acquired: false,
    heldBy: currentLock.pipelineSlug,
  };
}

/**
 * Release the analysis lock for a pipeline.
 * @param {string} pipelineSlug - The pipeline identifier that holds the lock
 * @throws {Error} If the lock is not held by this pipeline
 */
export function releaseLock(pipelineSlug) {
  if (!pipelineSlug || typeof pipelineSlug !== "string") {
    throw new Error(
      `Invalid pipelineSlug: expected non-empty string, got ${typeof pipelineSlug}`
    );
  }

  if (currentLock === null) {
    throw new Error(
      `Cannot release lock for '${pipelineSlug}': no lock is currently held`
    );
  }

  if (currentLock.pipelineSlug !== pipelineSlug) {
    throw new Error(
      `Cannot release lock for '${pipelineSlug}': lock is held by '${currentLock.pipelineSlug}'`
    );
  }

  currentLock = null;
}

/**
 * Get the current lock status.
 * @returns {{ pipelineSlug: string, startedAt: Date } | null}
 */
export function getLockStatus() {
  return currentLock;
}
