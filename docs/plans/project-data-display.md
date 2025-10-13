# Revised Project Data Display – LLM-Ready Implementation Plan

## Overview

## 0) Global Contracts & Constants (authoritative)

These rules govern every phase. Do not diverge.

### 0.1 Paths, IDs, and Layout

- **Roots**: `pipeline-data/current/`, `pipeline-data/complete/`.
- **Job directory**: `pipeline-data/{current|complete}/{job_id}/`
  - `tasks-status.json` (job index)
  - `seed.json` (optional)
  - `tasks/{task_name}/output.json` (task artifacts)
  - `tasks/{task_name}/letter.json` (optional)
  - `tasks/{task_name}/execution-logs.json` (optional)

- **Job identity**: `job_id` **is the directory name** and must match `^[A-Za-z0-9-_]+$`.
- **Precedence** if duplicate in both trees: **`current/` wins**.
- **Lock files**: any `*.lock` anywhere under `{job}/` means “locked for write.” Readers must back off and retry (see 1.3 Atomic Read).

### 0.2 Status & Progress

- **Task state enum**: `pending | running | done | error`. Unknown values → treat as `pending` and log a warning.
- **Job status**:
  - `running` if ≥1 task `running` and none `error`.
  - `error` if ≥1 task `error`.
  - `complete` if **all** tasks `done` and none `running`/`error`.
  - `pending` otherwise (e.g., all pending).

- **Progress**:
  - `progress_pct = round(100 * done_count / max(1, total_tasks))`.
  - `total_tasks = count of keys in "tasks" object`.
  - Zero-task jobs → `0`.

### 0.3 Canonical `tasks-status.json` (minimum fields)

```json
{
  "id": "string", // should equal job_id; mismatch → warn, prefer job_id
  "name": "string",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601?",
  "tasks": {
    "<task_name>": {
      "state": "pending|running|done|error",
      "startedAt": "ISO8601?",
      "endedAt": "ISO8601?",
      "attempts": "number?",
      "executionTimeMs": "number?",
      "artifacts": "string[]?" // e.g., ["tasks/<task_name>/output.json"]
    }
  }
}
```

### 0.4 Sorting & Grouping

- **Status sort order** (descending priority): `running` → `error` → `pending` → `complete`.
- **Within the same status**: sort by `createdAt` (ascending). If missing/invalid, fall back to job directory `ctime`.
- **Identity key**: `job_id` (directory name). If duplicates (should not happen), prefer `current/` then newest `createdAt`.

### 0.5 API & Errors

- **Error envelope** (all file readers & endpoints):

```json
{
  "ok": false,
  "code": "not_found|invalid_json|fs_error|job_not_found|bad_request",
  "message": "string",
  "path": "string?"
}
```

- **`GET /api/jobs`** → array of:

```json
{
  "id": "string",
  "name": "string",
  "status": "running|error|pending|complete",
  "progress": 0,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601?",
  "location": "current|complete"
}
```

- **`GET /api/jobs/:jobId`** → object:

```json
{
  "id": "string",
  "name": "string",
  "status": "running|error|pending|complete",
  "progress": 0,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601?",
  "location": "current|complete",
  "tasks": [
    {
      "name": "string",
      "state": "pending|running|done|error",
      "startedAt": "ISO8601?",
      "endedAt": "ISO8601?",
      "attempts": "number?",
      "executionTimeMs": "number?",
      "artifacts": "string[]?"
    }
  ]
}
```

### 0.6 SSE Semantics

- **Event types**:
  - `file:changed` (existing behavior remains)
  - `job:updated`

- **When to emit `job:updated`** (significant change):
  - any task `state` changed, **or**
  - `progress` changed by ≥ 1 percentage point, **or**
  - any task entered `error`.

- **Coalescing**: debounce per job with a 200ms window; last update wins.
- **Payload**: the **same shape** as `GET /api/jobs/:jobId`.
- **Client lifecycle**: keep existing heartbeats; reconnect with browser defaults.

### 0.7 Runtime & Testing

- **Node**: v20+, **ESM** modules.
- **UI server** and API share the same origin → no CORS required.
- **Tests**: Vitest + jsdom. Use **MSW** (or equivalent) for client hook testing. Polyfill `EventSource` for jsdom.

---

## Phase 0: Foundation

### 0.1 Test Infrastructure Setup

**Create**

- `tests/test-data-utils.js` – builders for ephemeral job trees.

**Acceptance**

- Can create/remove temp job trees under both `current/` and `complete/` following **0.1 Paths** exactly.
- Can generate valid `tasks-status.json` files that satisfy **0.3 Schema**.
- Utilities are OS-portable and leave no watchers/handles open.

**Unit Tests**

- Generated layout equals the directory & file set from **0.1**.
- JSON validates against **0.3** (required keys present; states legal).
- Teardown removes dirs; no locked files remain.

### 0.2 Configuration Bridge

**Create**

- `src/ui/config-bridge.js` – centralized access to pipeline paths & UI settings.

**Acceptance**

- Exposes absolute, existing paths for `pipeline-data/current` and `pipeline-data/complete`.
- Provides `isLocked(job_dir)` that detects any `*.lock` under the job.
- No duplication of constants—single source for paths.

**Unit Tests**

- Paths are absolute and exist.
- `isLocked` returns true when any lock file exists; false otherwise.
- Bridge reads from one config source; mocks override cleanly.

---

## Phase 1: File Reading

### 1.1 Job Directory Scanner

**Create**

- `src/ui/job-scanner.js`

**Acceptance**

- Lists **directory names only** (job IDs) under `current/` and `complete/`.
- Returns `[]` if dir missing/empty.
- Skips non-directories and hidden/system entries.

**Unit Tests**

- Missing dir → `[]`.
- Mixed files/dirs → only job dirs returned.
- Permission errors → returns `[]` and logs a warning (no throw).

### 1.2 Safe File Reader

**Create**

- `src/ui/file-reader.js`

**Acceptance**

- Reads JSON with UTF-8, tolerates BOM.
- Structured errors return the **Error envelope** (**0.5**) and **never throw**.
- Large file policy: read whole file up to 5MB; if larger, return `{code:"fs_error"}` with a clear message.

**Unit Tests**

- Valid JSON → parsed object.
- Missing file → `{ok:false, code:"not_found"}`.
- Malformed JSON → `{ok:false, code:"invalid_json"}`.
- > 5MB → `{ok:false, code:"fs_error"}`.

### 1.3 Job Status Reader

**Create**

- `src/ui/job-reader.js`

**Acceptance**

- Locates a job by `job_id` with **precedence**: `current/` then `complete/`.
- Applies **Atomic Read with Lock Awareness**:
  - If `isLocked(job)`, retry up to 3 attempts with 50ms delay.
  - If JSON parse fails, retry once (writer might be mid-write).

- Returns job data + `location`.

**Unit Tests**

- Finds in `current/` when in both.
- `job_not_found` for missing job.
- Concurrent writer simulation → retries then succeed.
- Returns `{location:"current|complete"}` correctly.

---

## Phase 2: Transformation

### 2.1 Status Transformer

**Create**

- `src/ui/transformers/status-transformer.js`

**Acceptance**

- Maps raw `tasks` to UI tasks with enum from **0.2**.
- Computes `status` and `progress` per **0.2**.
- When `id` in JSON ≠ `job_id`, include a warning field and prefer `job_id`.

**Unit Tests**

- Mapping for each state.
- Progress at 0%, 100%, and partials is correct.
- Unknown state → treated as `pending` with warning.
- Null input → null output.

### 2.2 List Aggregation

**Create**

- `src/ui/transformers/list-transformer.js`

**Acceptance**

- Merge lists from `current` and `complete` with **identity key** = `job_id`, **precedence** rules from **0.1/0.4**.
- Sort by **0.4 Sorting**.
- Optional grouping into buckets in the specified order.

**Unit Tests**

- Running before error before pending before complete.
- Stable ordering by `createdAt` within status.
- Null/invalid entries dropped gracefully.

---

## Phase 3: API

### 3.1 Job List Endpoint

**Create**

- `src/ui/endpoints/job-endpoints.js` (list handler)

**Modify**

- `src/ui/server.js` – add `GET /api/jobs`

**Acceptance**

- Returns array of job summaries matching **0.5 /api/jobs** shape.
- 200 on success; 500 on unexpected FS failures using **Error envelope**.
- Does not impact existing routes (`/`, `/api/state`, `/api/events`).

**Unit Tests**

- No jobs → `[]`.
- Multiple jobs across trees → all present with correct `location`.
- Malformed job file → excluded from list; server logs warning.

**Integration Tests**

- Existing endpoints still pass.
- SSE endpoint unaffected.

### 3.2 Job Detail Endpoint

**Create**

- `src/ui/endpoints/job-detail-endpoint.js`

**Modify**

- `src/ui/server.js` – add `GET /api/jobs/:jobId`

**Acceptance**

- `jobId` validated by regex in **0.1**.
- 200 with **0.5 detail schema** when found.
- 404 `{code:"job_not_found"}` when absent.
- Never returns task artifact file contents—only paths metadata.

**Unit Tests**

- Valid ID → full detail.
- Invalid ID (fails regex) → 400 `{code:"bad_request"}`.
- Nonexistent ID → 404.

---

## Phase 4: SSE

### 4.1 Job Change Detector

**Create**

- `src/ui/job-change-detector.js`

**Acceptance**

- Given a changed file path, identifies:
  - which **job_id** it belongs to,
  - whether it’s `status` (any `tasks-status.json`), `task` (anything under `tasks/**`), or `seed`.

- Ignores non-job paths.

**Unit Tests**

- Path parsing works on POSIX/Windows separators.
- Correct category per filename.
- Unknown paths → ignored.

### 4.2 Job-Specific Events

**Create**

- `src/ui/sse-enhancer.js`

**Modify**

- `src/ui/watcher.js` – integrate

**Acceptance**

- On significant changes (**0.6**), emits `job:updated` with the **detail schema**.
- Debounce/coalesce per job (200ms).
- Preserves existing `file:changed` behavior.

**Unit Tests**

- State flips trigger events.
- Progress deltas ≥1 trigger events; <1 do not.
- Multiple clients receive identical events.

---

## Phase 5: Client Hooks

### 5.1 `useJobList`

**Create**

- `src/ui/client/hooks/useJobList.js`

**Acceptance**

- On mount: fetch `/api/jobs`.
- Exposes `{loading, data, error, refetch}`.
- Aborts fetch on unmount.

**Unit Tests**

- Initial `loading=true`.
- Success → data populated, `loading=false`.
- Failure → `error` set, `loading=false`.
- `refetch` performs a new request.

### 5.2 `useJobListWithUpdates`

**Create**

- `src/ui/client/hooks/useJobListWithUpdates.js`

**Acceptance**

- Opens SSE connection; merges `job:updated` payloads into list by `id`.
- Preserves sort order per **0.4** after updates.
- Cleans up SSE on unmount.

**Unit Tests**

- Establishes SSE in jsdom (polyfilled).
- Update modifies existing job; unseen job is appended.
- Invalid SSE payloads ignored, no crash.

---

## Phase 6: UI Integration

### 6.1 Data Adapter

**Create**

- `src/ui/client/adapters/job-adapter.js`

**Acceptance**

- Maps API shapes (**0.5**) into component props (names, counts, times).
- Provides sensible defaults for missing optional fields.
- Backwards-compatibility: if fed the old demo shape, returns equivalent UI props.

**Unit Tests**

- All required UI props present.
- Missing fields → defaults applied.
- Timestamps formatted consistently (ISO in data layer; human format occurs in components).

### 6.2 Dashboard Migration

**Modify**

- `src/pages/PromptPipelineDashboard.jsx`

**Acceptance**

- Uses `useJobListWithUpdates` via the adapter.
- Shows loading state.
- On API error, falls back to demo dataset with a visible “demo data” banner.
- Existing interactions (filters, drill-downs) function with real data.

**Integration Tests**

- Renders with real data.
- Filter/search works.
- Job details match tasks presented.
- Fallback path renders when API returns 500.

---

## Validation Checkpoints (now measurable)

**Phase 1**

- `listJobs("current")` & `listJobs("complete")` return correct IDs.
- `readJob(job_id)` handles locked/partial writes via retry and returns `{location}`.

**Phase 2**

- Deterministic status & progress for golden fixtures.
- Aggregation yields stable sorted arrays.

**Phase 3**

- `/api/jobs` & `/api/jobs/:id` match schemas in **0.5** (JSON schema tests).
- Errors match the **Error envelope**.

**Phase 4**

- Changing `tasks-status.json` triggers exactly one `job:updated` (debounced).
- Payload equals detail API for that job.

**Phase 5**

- Hooks render expected states, pass MSW tests, and clean up on unmount.

**Phase 6**

- Dashboard shows real jobs; drill-downs accurate; fallback banner on API failure.

---

## Risk, Rollback, Monitoring (clarified)

- **Feature flag**: `UI_REAL_DATA=1` enables real API/SSE; otherwise demo-only. Read once via `config-bridge`.
- **Rollback**: Disable the flag to revert instantly; no data migration required.
- **Logging**:
  - Readers: warn on mismatched `id`, unknown task states, and skipped invalid jobs.
  - Endpoints: log error envelope JSON (no stacks) with a rate limit.
  - SSE: per-job coalescing counts.

- **Alerts**: warn if error rate for `/api/jobs` >2% in 5-min window or if SSE reconnects >3/min per client.
