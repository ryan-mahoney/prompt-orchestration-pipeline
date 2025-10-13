# Build Initial UI State from pipeline-data

## Why

The UI should render a meaningful job list on first paint. Scanning pipeline-data for jobs and composing a minimal snapshot ensures the client bootstraps without relying on SSE or ad-hoc polling.

## Goals

- Populate GET /api/state with a compact snapshot composed from pipeline-data.
- Ensure the client can fetch /api/state during bootstrap, hydrate the global state, then connect to SSE for incremental updates.
- Keep payloads small: include only minimal job metadata (id, name, status, progress, createdAt, updatedAt, location).

## Snapshot Contract

- Endpoint: GET /api/state
- Response shape:
  {
  "jobs": [
  {
  "id": "market-analysis",
  "name": "Market Analysis",
  "status": "error",
  "progress": 0,
  "createdAt": "2025-10-07T06:11:07.544Z",
  "updatedAt": "2025-10-07T06:11:07.626Z",
  "location": "current"
  }
  ],
  "meta": { "version": "1", "lastUpdated": "2025-10-10T07:20:00.000Z" }
  }

Notes:

- status and progress derived from `tasks-status.json` (legacy mapping: `failed` -> `error`).
- name falls back to `"Unnamed Job"` when missing.
- Deduplicate jobs across `current` and `complete` by id, preferring `current`.
- Exclude large artifacts; keep snapshot minimal.

## Inputs, Paths, and Environment

- Use `src/ui/config-bridge.js` PATHS to resolve data roots:
  - PATHS.current -> pipeline-data/current
  - PATHS.complete -> pipeline-data/complete
- Environment variables:
  - `PO_ROOT` sets the base directory for pipeline-data and pipeline-config.
  - `WATCHED_PATHS` should include `pipeline-data` for SSE-driven live updates.
- Primary file: `tasks-status.json` (per-job index). `seed.json` is optional and not required for the initial list.

## Server Implementation Steps

Step 1 — Add a filesystem snapshot composer

- Add an async function `buildSnapshotFromFilesystem(deps)` to `src/ui/state-snapshot.js` (or extend that module).
- Dependencies (inject for testability):
  - `listAllJobs()` (from `src/ui/job-scanner.js`)
  - `readJob(jobId, location)` (from `src/ui/job-reader.js`)
  - `transformMultipleJobs(readResults)` (from `src/ui/transformers/status-transformer.js`)
  - `now()` -> `() => new Date()`
  - `paths` (PATHS or resolved paths)
- Behavior:
  - Call `listAllJobs()` -> `{ current: [], complete: [] }`.
  - Build a read list of `{ id, location }` for current then complete.
  - Read each job with `readJob(id, location)`; attach `jobId` and `location` to the read result so transformers have context.
  - Call `transformMultipleJobs(readResults)` to normalize jobs into the canonical UI job objects.
  - Deduplicate by `id` keeping the first (current-before-complete).
  - Sort jobs by:
    1. location (current before complete)
    2. status priority (use `Constants.STATUS_ORDER`)
    3. updatedAt descending (fallback to createdAt)
    4. id ascending
  - Map transformed job object -> minimal snapshot fields:
    `{ id, name, status, progress, createdAt, updatedAt, location }`
  - Compose meta: `{ version: "1", lastUpdated: now().toISOString() }`
  - Return `composeStateSnapshot({ jobs: snapshotJobs, meta })`.

Step 2 — Wire GET /api/state to the composer

- In `src/ui/server.js`:
  - Replace `res.end(JSON.stringify(state.getState()))` (for `/api/state`) with:
    - `const snapshot = await buildSnapshotFromFilesystem(realDeps)`
    - `res.writeHead(200, { "Content-Type": "application/json" });`
    - `res.end(JSON.stringify(snapshot));`
  - Add robust error handling: if the composer throws, return 500 with a structured error envelope.

Step 3 — Keep SSE incremental

- Do not stream full state over SSE. Continue emitting typed, minimal events:
  - `state:change` with small change payloads
  - `state:summary` as a lightweight tick
- Ensure `WATCHED_PATHS` includes `pipeline-data` in demo/dev to allow watcher to detect file changes.

## Client Considerations

- No changes required to `src/ui/client/bootstrap.js` — it already:
  - Fetches `/api/state`, awaits `applySnapshot`, then creates `EventSource`.
- Ensure client state hydrators (hooks/reducers) accept the snapshot job shape and do not expect additional fields.

## Error Handling & Edge Cases

- Missing directories -> return `{ jobs: [], meta }`.
- Invalid job directory names -> skip and console.warn.
- `readJob` failures -> skip the failing job and console.warn with context.
- Unknown or invalid task states -> transformer maps to `pending` and emits warnings; `failed` maps to `error`.

## Sorting Details

- Location weight: `current` = 0, `complete` = 1.
- Status priority: follow `Constants.STATUS_ORDER` (lower index = higher priority).
- Time: `updatedAt` (fallback to `createdAt`) descending.
- Tie-breaker: `id.localeCompare`.

## Performance Notes

- Use concurrent reads with a reasonable concurrency cap (Promise.all is acceptable for demo-scale).
- Do not read artifact files (task outputs) — only read `tasks-status.json` and minimal per-job metadata.
- Keep snapshot generation quick for responsive client boot.

## Tests to Add or Update

Unit tests (state-snapshot composer):

- Empty pipeline-data -> empty jobs array.
- Duplicate job ids in current+complete -> dedupe preserves current.
- Sorting rules produce expected order.
- Legacy state mapping (`failed`) -> transforms to `error`.
- Unknown task states produce console warnings and `pending` fallback.

Integration tests (server):

- Start server with a temp `pipeline-data` tree and assert `/api/state` returns the snapshot contract.
- Error path: simulate readJob throwing and assert 500 with structured error.

SSE tests:

- Confirm SSE event shapes remain incremental (no full state dump).
- Confirm watcher + SSE broadcast on file changes when `WATCHED_PATHS` includes `pipeline-data`.

## Demo / Runbook

- Build UI: `npm run ui:build`
- Start demo with pipeline-data watched:
  WATCHED_PATHS="pipeline-config,pipeline-data,demo" node demo/run-demo.js run market-analysis
- Verify:
  - Initial job list appears immediately (hydrated from `/api/state`).
  - SSE delivers incremental updates (no full-state payloads).

## Appendix — Composer pseudo-code

async function buildSnapshotFromFilesystem({ listAllJobs, readJob, transformMultipleJobs, now, paths }) {
const { current = [], complete = [] } = await listAllJobs();
const toRead = [
...current.map((id) => ({ id, location: "current" })),
...complete.map((id) => ({ id, location: "complete" })),
];

const readResults = await Promise.all(
toRead.map(async ({ id, location }) => {
const res = await readJob(id, location);
return { ...res, jobId: id, location };
})
);

const transformed = transformMultipleJobs(readResults);

// Dedupe: prefer earlier entries (current before complete)
const seen = new Set();
const deduped = [];
for (const j of transformed) {
if (seen.has(j.id)) continue;
seen.add(j.id);
deduped.push(j);
}

// Sorting
const locWeight = (loc) => (loc === "current" ? 0 : 1);
const statusPrio = (status) =>
configBridge.Constants.STATUS_ORDER.indexOf(status) || configBridge.Constants.STATUS_ORDER.length;
const getTime = (j) => j.updatedAt || j.createdAt || null;

deduped.sort((a, b) => {
const lw = locWeight(a.location) - locWeight(b.location);
if (lw !== 0) return lw;
const sp = statusPrio(a.status) - statusPrio(b.status);
if (sp !== 0) return sp;
const ta = getTime(a);
const tb = getTime(b);
if (ta && tb && ta !== tb) return ta < tb ? 1 : -1;
if (ta && !tb) return -1;
if (!ta && tb) return 1;
return a.id.localeCompare(b.id);
});

const snapshotJobs = deduped.map((j) => ({
id: j.id,
name: j.name || "Unnamed Job",
status: j.status || "pending",
progress: Number.isFinite(j.progress) ? j.progress : 0,
createdAt: j.createdAt || null,
updatedAt: j.updatedAt || j.createdAt || null,
location: j.location || "current",
}));

const meta = { version: "1", lastUpdated: now().toISOString() };
return composeStateSnapshot({ jobs: snapshotJobs, meta });
}
