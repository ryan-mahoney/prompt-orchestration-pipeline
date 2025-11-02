/**
 * Job change detector
 *
 * Exports:
 *  - detectJobChange(filePath) -> { jobId, category, filePath } | null
 *  - getJobLocation(filePath) -> 'current' | 'complete' | 'pending' | 'rejected' | null
 *
 * Normalizes Windows backslashes to forward slashes for detection.
 * Supports absolute paths and all lifecycle directories.
 */

const JOB_ID_RE = /^[A-Za-z0-9-_]+$/;

/**
 * Normalize path separators to forward slash and trim
 */
function normalizePath(p) {
  if (!p || typeof p !== "string") return "";
  return p.replace(/\\/g, "/").replace(/\/\/+/g, "/");
}

/**
 * Determine the job location ('current'|'complete'|'pending'|'rejected') from a path, or null.
 * Accepts both relative and absolute paths, always returns the lifecycle name.
 */
export function getJobLocation(filePath) {
  const p = normalizePath(filePath);
  const m = p.match(
    /^.*?pipeline-data\/(current|complete|pending|rejected)\/([^/]+)\/?/
  );
  if (!m) return null;
  return m[1] || null;
}

/**
 * Given a file path, determine whether it belongs to a job and what category the change is.
 * Categories: 'status' (tasks-status.json), 'task' (anything under tasks/**), 'seed' (seed.json)
 * Accepts absolute paths and returns normalized filePath (always starting with "pipeline-data/...").
 */
export function detectJobChange(filePath) {
  const p = normalizePath(filePath);

  // Must start with optional prefix + pipeline-data/{current|complete|pending|rejected}/{jobId}/...
  const m = p.match(
    /^.*?pipeline-data\/(current|complete|pending|rejected)\/([^/]+)\/(.*)$/
  );
  if (!m) return null;

  const [, location, jobId, rest] = m;
  if (!JOB_ID_RE.test(jobId)) return null;

  const normalized = `pipeline-data/${location}/${jobId}/${rest}`;

  // status
  if (rest === "tasks-status.json") {
    return {
      jobId,
      category: "status",
      filePath: normalized,
    };
  }

  // seed
  if (rest === "seed.json") {
    return {
      jobId,
      category: "seed",
      filePath: normalized,
    };
  }

  // tasks/** (task artifacts)
  if (rest.startsWith("tasks/")) {
    return {
      jobId,
      category: "task",
      filePath: `pipeline-data/${location}/${jobId}/${rest}`,
    };
  }

  // anything else is not relevant
  return null;
}
