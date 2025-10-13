Goal Enforce an ID-only storage invariant across the entire pipeline with no fallbacks. Any name-based folder creation/consumption is removed. Incoming seeds are accepted only via id-based pending files ({jobId}-seed.json) that result in current/{jobId}/… directories.

Non-negotiable invariants after changes

- Orchestrator moves pending/{jobId}-seed.json to current/{jobId}/seed.json only.
- tasks-status.json, job.json, pipeline.json reside under current/{jobId}/.
- Runner receives jobId (not name) as its identifier.
- Readers/scanners accept only IDs that match the configured regex; slug/name folders are ignored.
- No code path may create or rely on current/{name}/…; no back-compat fallback.

Step 1: Orchestrator uses jobId only (strict)

- Changes (src/core/orchestrator.js):
  - In handleSeedAdd, derive jobId strictly from the pending filename:
    - const base = path.basename(filePath);
    - const m = base.match(/^([A-Za-z0-9-_]+)-seed\.json$/);
    - if (!m) { console.warn("Rejecting non-id seed file:", base); return; }
    - const jobId = m[1];
  - Remove any use of seed.name/seed.job/seed.jobName for folder naming.
  - Move to current/{jobId}/seed.json and create tasks-status.json in current/{jobId}/.
  - Set tasks-status.json fields: { id: jobId, name: seed?.name ?? jobId, pipelineId, createdAt, state: "pending", tasks: {} }.
  - Spawn runner with jobId (spawnRunner(jobId, …)).
- Verification:
  - Upload a seed → expect only current/{jobId}/… created; no current/{name}/ exists.

Step 2: Remove legacy name-based submit

- Changes (src/api/index.js):
  - Delete or hard-error legacy submitJob(state, seed) that writes pending/{name}-seed.json.
  - If retained, make it throw with a clear message to use submitJobWithValidation (id-only).
- Verification:
  - Search repo: no call sites rely on name-based submit. Tests updated to call submitJobWithValidation.

Step 3: Runner argument is jobId

- Changes (src/core/orchestrator.js, src/core/pipeline-runner.js):
  - Ensure runner consumes jobId (the single CLI arg) and relies on PO\_\* env for directories.
  - Remove any name-based path logic if present.
- Verification:
  - Unit test ensures runner locates current/{jobId}/seed.json and runs without depending on name.

Step 4: Readers/Scanners strictly enforce ID format

- Changes (src/ui/job-reader.js, src/ui/job-scanner.js):
  - Confirm only config-bridge.Constants.JOB_ID_REGEX is accepted.
  - No transforms from name → id; slug/invalid ids must be rejected or ignored.
- Verification:
  - tests/id-only-storage.test.js passes; extend with a negative case that slug dirs are ignored and read returns job_not_found.

Step 5: Reject non-id pending files (no fallback)

- Changes (src/core/orchestrator.js):
  - If pending filename does not match ^([A-Za-z0-9-_]+)-seed\.json$, log and skip. Do not move, do not create any directory.
- Verification:
  - Unit test drops pending/content-generation-seed.json → nothing is created under current/, only a warning log.

Step 6: Tests updated and added

- Changes:
  - New orchestrator test: pending/abc123-seed.json → current/abc123/seed.json; no current/{name}/.
  - Update tests/upload-api.test.js and tests/e2e-upload.test.js to assert absence of current/{jobName}/ and presence of current/{jobId}/.
  - Extend tests/id-only-storage.test.js with “no name-based folders after upload”.
- Verification:
  - npm -s test: all green.

Step 7: Documentation purge of name-based paths

- Changes:
  - README.md, docs/storage.md, docs/project-seed-upload.md, docs/architecture.md: replace current/{name} with current/{id}.
  - Remove any mention of backwards compatibility/migration at runtime.
- Verification:
  - Repo-wide grep finds no “current/{name}” or “current/<name>” references.

Step 8: Hard guard to prevent regressions

- Changes:
  - Optional CI check or script: grep -R "current/\{name\}|current/<name>|-seed\.json.\*name" to fail CI on reintroduction.
- Verification:
  - CI fails if someone re-adds name-based logic.

Step 9: Manual acceptance

- Steps:
  - Upload via UI → observe only ID-based folders under pipeline-data/current and pipeline-data/complete.
  - Confirm /api/jobs lists the new job by jobId; /api/jobs/:jobId returns detail with id matching folder name.
  - No name-based directories created anywhere.

Step 10: Migration note (no runtime back-compat)

- Stance:
  - Runtime does not support legacy name-based data. If needed, provide a one-off external script to consolidate legacy current/{name}/ into current/{id}/; not shipped or invoked by the app.
