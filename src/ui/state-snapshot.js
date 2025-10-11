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

/**
 * Build a minimal snapshot composed from files on disk.
 *
 * deps (optional) - injected dependencies for testability:
 *  - listAllJobs() -> { current: [], complete: [] }
 *  - readJob(jobId, location) -> { ok:true, data, location, path } or error envelope
 *  - transformMultipleJobs(readResults) -> Array<job>
 *  - now() -> () => new Date()
 *  - paths -> optional resolved PATHS object
 *
 * Behavior:
 *  - Reads job ids from current then complete
 *  - Reads each job (attach jobId & location to the read result)
 *  - Transforms reads, dedupes (prefer current), sorts, maps to minimal job fields
 *  - Returns { jobs: [...], meta: { version: "1", lastUpdated } }
 */
export async function buildSnapshotFromFilesystem(deps = {}) {
  // Prefer injected deps; fall back to local modules for convenience.
  const { listAllJobs, readJob, transformMultipleJobs, now, paths } = deps;

  // Lazy-import fallbacks when deps not provided.
  // These imports are intentionally dynamic to avoid circular/boot-time issues in tests.
  const jobScanner = listAllJobs
    ? null
    : await import("./job-scanner.js").then((m) => m).catch(() => null);
  const jobReader = readJob
    ? null
    : await import("./job-reader.js").then((m) => m).catch(() => null);
  const statusTransformer = transformMultipleJobs
    ? null
    : await import("./transformers/status-transformer.js")
        .then((m) => m)
        .catch(() => null);
  const configBridge = await import("./config-bridge.js")
    .then((m) => m)
    .catch(() => null);

  const _listAllJobs = listAllJobs || (jobScanner && jobScanner.listAllJobs);
  const _readJob = readJob || (jobReader && jobReader.readJob);
  const _transformMultipleJobs =
    transformMultipleJobs ||
    (statusTransformer && statusTransformer.transformMultipleJobs);
  const _now = typeof now === "function" ? now : () => new Date();
  const _paths = paths || (configBridge && configBridge.PATHS) || null;

  if (typeof _listAllJobs !== "function") {
    throw new Error("Missing dependency: listAllJobs");
  }
  if (typeof _readJob !== "function") {
    throw new Error("Missing dependency: readJob");
  }
  if (typeof _transformMultipleJobs !== "function") {
    throw new Error("Missing dependency: transformMultipleJobs");
  }

  // 1) Enumerate jobs
  const all = (await _listAllJobs()) || {};
  const currentIds = Array.isArray(all.current) ? all.current : [];
  const completeIds = Array.isArray(all.complete) ? all.complete : [];

  // Build read order: current first, then complete
  const toRead = [
    ...currentIds.map((id) => ({ id, location: "current" })),
    ...completeIds.map((id) => ({ id, location: "complete" })),
  ];

  // If no jobs, return empty snapshot
  if (toRead.length === 0) {
    const meta = { version: "1", lastUpdated: _now().toISOString() };
    return { jobs: [], meta };
  }

  // 2) Read jobs concurrently (Promise.all is acceptable for demo-scale)
  const readPromises = toRead.map(async ({ id, location }) => {
    try {
      // Call readJob with (id, location) - extra arg is ignored by implementations that don't accept it.
      const res = await _readJob(id, location);
      // Ensure we attach jobId and location for downstream transformers
      if (res && typeof res === "object") {
        return { ...res, jobId: id, location };
      }
      // If readJob returns non-object, wrap as error
      return {
        ok: false,
        code: "read_error",
        message: "Invalid read result",
        jobId: id,
        location,
      };
    } catch (err) {
      console.warn(
        `Error reading job ${id} in ${location}: ${err?.message || String(err)}`
      );
      return {
        ok: false,
        code: "read_exception",
        message: err?.message || String(err),
        jobId: id,
        location,
      };
    }
  });

  const readResults = await Promise.all(readPromises);

  // 3) Transform reads into canonical job objects
  const transformed = _transformMultipleJobs(readResults || []);

  // 4) Dedupe by id, preferring earlier entries (current before complete)
  const seen = new Set();
  const deduped = [];
  for (const j of transformed || []) {
    if (!j || !j.id) continue;
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    deduped.push(j);
  }

  // 5) Sorting
  // Location weight: current=0, complete=1
  const locWeight = (loc) => (loc === "current" ? 0 : 1);

  // Status priority from Constants if available
  const statusOrder = (configBridge &&
    configBridge.Constants &&
    configBridge.Constants.STATUS_ORDER) || [
    "error",
    "running",
    "complete",
    "pending",
  ];

  const statusPriority = (s) => {
    const idx = statusOrder.indexOf(s);
    return idx === -1 ? statusOrder.length : idx;
  };

  const getTime = (j) => {
    const ua =
      j && j.updatedAt ? j.updatedAt : j && j.createdAt ? j.createdAt : null;
    if (!ua) return null;
    // Ensure we compare ISO strings or timestamps consistently
    const t = Date.parse(ua);
    return Number.isNaN(t) ? null : t;
  };

  deduped.sort((a, b) => {
    // 1) location
    const lw = locWeight(a.location) - locWeight(b.location);
    if (lw !== 0) return lw;

    // 2) status priority (lower is higher priority)
    const sp = statusPriority(a.status) - statusPriority(b.status);
    if (sp !== 0) return sp;

    // 3) updatedAt descending (newer first)
    const ta = getTime(a);
    const tb = getTime(b);
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;

    // 4) id ascending
    return String(a.id).localeCompare(String(b.id));
  });

  // 6) Map to minimal snapshot fields
  const snapshotJobs = deduped.map((j) => ({
    id: j.id,
    name: j.name || "Unnamed Job",
    status: j.status || "pending",
    progress:
      typeof j.progress === "number" && Number.isFinite(j.progress)
        ? j.progress
        : 0,
    createdAt: j.createdAt || null,
    updatedAt: j.updatedAt || j.createdAt || null,
    location: j.location || "current",
  }));

  const meta = { version: "1", lastUpdated: _now().toISOString() };

  return { jobs: snapshotJobs, meta };
}
