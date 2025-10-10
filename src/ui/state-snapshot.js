/**
 * composeStateSnapshot
 *
 * Pure function that composes a minimal snapshot object for client bootstrap.
 *
 * Signature:
 *   composeStateSnapshot(options?)
 *
 * options:
 *   - jobs: Array of job-like objects (optional)
 *   - meta: Object with metadata (optional)
 *   - transformJob: optional function(job) -> normalizedJob to customize normalization
 *
 * Returns:
 *   {
 *     jobs: [{ id: string, status: string|null, summary: string|null, updatedAt: string|null }, ...],
 *     meta: { version: string|number, lastUpdated: string }
 *   }
 *
 * Notes:
 * - This function is pure and does not perform I/O or mutate inputs.
 * - It is defensive about input shapes and provides sensible defaults.
 */

export function composeStateSnapshot(options = {}) {
  const { jobs = [], meta, transformJob } = options || {};

  // Ensure we don't mutate input arrays/objects; work on copies.
  const inputJobs = Array.isArray(jobs) ? jobs.slice() : [];

  const normalizedJobs = inputJobs.map((j) => {
    // If caller provided a transformJob, prefer its output but still normalize missing fields.
    if (typeof transformJob === "function") {
      const t = transformJob(j) || {};
      return {
        id: t.id != null ? String(t.id) : null,
        status: t.status ?? null,
        summary: t.summary ?? null,
        updatedAt: t.updatedAt ?? t.lastUpdated ?? null,
      };
    }

    // Best-effort normalization for common fields seen in this repo.
    const rawId = j?.id ?? j?.jobId ?? j?.uid ?? j?.job_id ?? j?.jobID ?? null;
    const rawStatus = j?.status ?? j?.state ?? j?.s ?? null;
    const rawSummary = j?.summary ?? j?.title ?? j?.name ?? null;
    const rawUpdated = j?.updatedAt ?? j?.lastUpdated ?? j?.updated_at ?? null;

    return {
      id: rawId != null ? String(rawId) : null,
      status: rawStatus ?? null,
      summary: rawSummary ?? null,
      updatedAt: rawUpdated ?? null,
    };
  });

  const resultMeta = {
    version: meta?.version ?? meta ?? "1",
    lastUpdated: meta?.lastUpdated ?? new Date().toISOString(),
  };

  return {
    jobs: normalizedJobs,
    meta: resultMeta,
  };
}
