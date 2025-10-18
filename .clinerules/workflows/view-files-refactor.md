<task_objective>
Run this workflow **start-to-finish with zero human interaction**, operating on the **current branch** (no new branch). For each step, automatically choose the most pragmatic approach, carry forward critical context into the fresh execution context created between steps, and make a **Conventional Commit** at the end of the step (use an empty commit if no files change). Do **not** include code in this workflow; describe actions precisely so the agent can execute them with full repository access (no explicit read/search commands needed).
</task_objective>

<detailed_sequence_of_steps>

### Step 1 — Confirm legacy endpoint file is unused

**Goal:** Ensure `src/ui/endpoints/job-detail-endpoint.js` isn’t referenced.

- Search the codebase for references to **"endpoints/job-detail-endpoint"** and **"getJobDetailHandler"** within `src/**/*.js` and `src/**/*.jsx`.
- **If matches exist:** Replace all usages with the supported `handleJobDetail` from `src/ui/endpoints/job-endpoints.js`, keeping request/param handling consistent. Re-run searches to confirm **0 matches** remain.
- **Acceptance:** 0 matches remain for both strings.
- **Commit:**
  - If no changes: `chore(endpoints): verify legacy job-detail-endpoint is unused (no changes)` _(empty commit allowed)_
  - If replacements were needed: `refactor(endpoints): replace legacy job-detail-endpoint references with handleJobDetail`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 2 — Remove legacy endpoint file

**Goal:** Delete `src/ui/endpoints/job-detail-endpoint.js`.

- Remove the file.
- Verify server routing in `src/ui/server.js` (or equivalent) continues to route `GET /api/jobs/:jobId` through `handleJobDetail(jobId)` from `src/ui/endpoints/job-endpoints.js`.
- **Acceptance:** Route remains functional via `handleJobDetail` with no references to the removed file.
- **Commit:** `refactor(endpoints): remove legacy job-detail-endpoint module`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 3 — Remove tests referencing the legacy module

**Goal:** Eliminate any tests that import/mention the removed endpoint.

- Search `tests/**/*.{js,jsx}` for imports or mentions of **"job-detail-endpoint"** or **"getJobDetailHandler"**.
- Delete any matching test files or update them to target supported endpoints if appropriate (prefer deletion to preserve scope of this change).
- Re-run the search to confirm **0 matches** remain.
- **Acceptance:** No tests import or reference the legacy module.
- **Commit:** `test(cleanup): remove tests referencing legacy job-detail-endpoint`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 4 — Add job-level files to `transformJobStatus`

**Goal:** Ensure the transformer attaches a stable `job.files` object.

- File: `src/ui/transformers/status-transformer.js`
- Function: `transformJobStatus(raw, jobId, location)`
- After the job object is constructed (`id, name, status, progress, createdAt, updatedAt, location, tasks`), attach `job.files` using this behavior:
  - If `raw.files` is an object, create arrays for `artifacts`, `logs`, `tmp` by _copying_ any arrays present; otherwise default each to an empty array.
  - **Do not** map any legacy top-level `artifacts`; only `job.files.*` should exist.
  - Maintain immutability (avoid mutating `raw`).

- **Acceptance:** Returned job always includes `files` with `artifacts/logs/tmp` arrays (present or empty).
- **Commit:** `feat(transformers): attach job.files {artifacts,logs,tmp} with safe defaults`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 5 — Verify endpoint preserves `job.files`

**Goal:** Ensure `src/ui/endpoints/job-endpoints.js` returns the fully transformed job (including `job.files`) for both cache-hit and direct-read paths.

- Review the endpoint to confirm it returns the **transformed** job payload without filtering out `files`.
- No code change expected; if any filtering is discovered, remove that filtering.
- **Acceptance:** Endpoint response includes `job.files` consistently.
- **Commit:**
  - If no changes: `chore(api): verify job-endpoints returns job.files as-is (no changes)` _(empty commit)_
  - If adjustments needed: `fix(api): ensure job-endpoints returns job.files in all paths`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 6 — Update API integration test fixture to include job-level files

**Goal:** Ensure integration tests represent the new schema.

- File: `tests/job-detail-api.integration.test.js`
- In `beforeEach()` (or equivalent fixture setup), extend `tasksStatus` with top-level `files`, e.g.:
  `files: { artifacts: ["job-a1.json"], logs: ["job.log"], tmp: ["tmp-1.txt"] }`
- Persist the updated `tasksStatus` to the temp job path: `{tempDir}/pipeline-data/current/{jobId}/tasks-status.json`.
- **Acceptance:** Fixture mirrors the schema with top-level `files`.
- **Commit:** `test(api): include job-level files in tasksStatus fixture for job-detail`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 7 — Add API assertions for `job.files`

**Goal:** Assert presence and values of `job.files` in the API response.

- In the test `"returns job detail with new files.* schema instead of legacy artifacts"`:
  - Assert `result.data.files` exists.
  - Assert `files.artifacts == ["job-a1.json"]`, `files.logs == ["job.log"]`, `files.tmp == ["tmp-1.txt"]`.
  - Assert `result.data` **does not** have legacy `artifacts` top-level.

- Keep existing assertions for per-task files and absence of per-task legacy artifacts.
- **Acceptance:** Test passes with the new expectations.
- **Commit:** `test(api): assert job.files {artifacts,logs,tmp} present; legacy artifacts absent`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 8 — Add transformer unit tests for job-level files (recommended)

**Goal:** Unit-test transformer behavior for present/missing `files`.

- Create/extend tests (e.g., `tests/status-transformer.files.test.js`) with:
  - **Case A (present):** `raw.files` contains arrays; transformed `job.files` matches those arrays.
  - **Case B (missing):** `raw.files` absent; transformed `job.files` exists with empty arrays.

- **Acceptance:** Both cases pass and guard against regressions.
- **Commit:** `test(transformers): cover job.files present/missing cases in transformJobStatus`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 9 — Reconcile tests that assumed missing `job.files`

**Goal:** Align the rest of the test suite with the new invariant.

- Scan tests for negative assertions (e.g., `expect(...files).toBeUndefined()`).
- Update to assert presence of empty arrays or remove assertions that are no longer valid.
- **Acceptance:** No tests fail due to the invariant that `job.files.*` arrays always exist.
- **Commit:** `test: reconcile assertions to expect job.files arrays (possibly empty)`

</detailed_sequence_of_steps>
<new_task/>

<detailed_sequence_of_steps>

### Step 10 — Run the full test suite and finalize

**Goal:** Finish the migration with a green build.

- Execute the full test suite quietly; investigate and resolve any regressions uncovered by schema changes (limited to assertions or minor hygiene).
- Ensure tests are deterministic (no flakiness) and all pass.
- **Acceptance:** All tests pass; endpoint and transformer behavior verified end-to-end.
- **Commit:** `chore: finalize job.files migration with green test suite`

</detailed_sequence_of_steps>
