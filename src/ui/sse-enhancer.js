/**
 * SSE Enhancer
 *
 * Provides a factory createSSEEnhancer({ readJobFn, sseRegistry, debounceMs })
 * and a singleton export sseEnhancer created with default dependencies.
 *
 * Behavior:
 *  - handleJobChange({ jobId, category, filePath })
 *    - debounce per jobId (default 200ms)
 *    - after debounce, call readJobFn(jobId) to obtain latest detail
 *    - if read succeeds (ok), broadcast { type: "job:updated", data: detail }
 *    - if read fails, do not broadcast
 *  - getPendingCount() returns number of pending timers
 *  - cleanup() clears timers
 */

import { detectJobChange } from "./job-change-detector.js";

export function createSSEEnhancer({
  readJobFn,
  sseRegistry,
  debounceMs = 200,
} = {}) {
  if (!readJobFn) {
    throw new Error("readJobFn is required");
  }
  if (!sseRegistry) {
    throw new Error("sseRegistry is required");
  }

  const pending = new Map(); // jobId -> timeoutId

  async function runJobUpdate(jobId) {
    try {
      const res = await readJobFn(jobId);
      if (!res || !res.ok) {
        return;
      }

      // Build payload: reuse returned data as detail (readJob returns data/raw)
      const detail = res.data || {};
      sseRegistry.broadcast({ type: "job:updated", data: detail });
    } catch (err) {
      // swallow errors - do not broadcast
      return;
    } finally {
      pending.delete(jobId);
    }
  }

  function handleJobChange(change) {
    if (!change || !change.jobId) return;

    const jobId = change.jobId;

    // debounce/coalesce per jobId
    if (pending.has(jobId)) {
      clearTimeout(pending.get(jobId));
    }

    const t = setTimeout(() => {
      pending.delete(jobId);
      // fire async update
      void runJobUpdate(jobId);
    }, debounceMs);

    pending.set(jobId, t);
  }

  function getPendingCount() {
    return pending.size;
  }

  function cleanup() {
    for (const [_, t] of pending) {
      clearTimeout(t);
    }
    pending.clear();
  }

  return {
    handleJobChange,
    getPendingCount,
    cleanup,
  };
}

// Singleton using default dependencies if available
// Try to import default sseRegistry and readJobFn lazily to avoid cycles
let sseEnhancer = null;
try {
  // eslint-disable-next-line import/no-mutable-exports
  const { sseRegistry } = await import("./sse.js");
  const { readJob } = await import("./job-reader.js");
  sseEnhancer = createSSEEnhancer({
    readJobFn: readJob,
    sseRegistry,
    debounceMs: 200,
  });
} catch (err) {
  // In test environments, consumers will create their own using the factory
  // Leave sseEnhancer as null if dependencies not available
  // eslint-disable-next-line no-console
  console.warn("sseEnhancer singleton not initialized:", err?.message || err);
}

export { sseEnhancer };
