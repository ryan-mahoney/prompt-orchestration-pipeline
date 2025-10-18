<task_objective>
Refactor the UI server’s task file endpoints to determine a single lifecycle folder (e.g., current, complete, rejected) at request time and serve files exclusively from that directory, eliminating the fallback approach. Implement a short-term security hotfix first (switch jail check to OR), then introduce a lifecycle resolver and refactor both list and file endpoints to use a single resolved base with a safer path jail. The workflow must run start-to-finish with no human interaction, automatically choosing the most pragmatic approach, making a Conventional Commit at the end of each section, and carrying forward critical context between steps.
</task_objective>

<detailed_sequence_of_steps>

## Step 0 — Security hotfix: tighten path jail immediately

- Goal: Close the immediate vulnerability before deeper refactors.
- Actions:
  - In both task file handlers (list and file), change the jail guard to OR so that if either resolved path fails the jail check, the request is blocked.
  - Keep all behavior otherwise unchanged; this is a minimal risk hotfix while refactor proceeds.
- Acceptance:
  - AND → OR applied in both places.
  - Tests still green (no behavior regressions).
- Conventional Commit:
  - fix(ui-server): harden path jail by using OR for single-failure blocking

<new_task>
<context>
Carry-over:

- Immediate fix landed: jail check now blocks if either path escapes.
- Next: Remove fallback concept entirely by selecting a single lifecycle at request time.
- Endpoints unchanged:
  - GET /api/jobs/:jobId/tasks/:taskId/files?type=artifacts|logs|tmp
  - GET /api/jobs/:jobId/tasks/:taskId/file?type=...&filename=...
- Environment: PO_ROOT defines data base; lifecycles include current, complete, rejected (present in repo).
  </context>
  </new_task>

## Step 1 — Add lifecycle resolution helper

- Goal: Determine exactly one lifecycle per request.
- Actions:
  - Introduce resolveJobLifecycle(dataDir, jobId), preferring a filesystem-based determination:
    - If job directory exists under current → return "current"
    - Else if under complete → return "complete"
    - Else if under rejected → return "rejected"
    - Else → return null (job not found)
  - Keep it pure, deterministic, and fast; do not change API shape.
- Acceptance:
  - Helper returns one of current|complete|rejected|null based on dir existence.
  - Unit tests for the helper (cover positives/negatives).
- Conventional Commit:
  - feat(ui-server): add resolveJobLifecycle helper to choose single lifecycle deterministically

<new_task>
<context>
Carry-over:

- resolveJobLifecycle exists and works deterministically via FS existence checks.
- Next: Apply lifecycle selection in list endpoint and remove fallback probing.
  </context>
  </new_task>

## Step 2 — Refactor list endpoint to single-lifecycle serving

- Goal: Stop probing across multiple lifecycles and serve from exactly one.
- Actions:
  - In handleTaskFileListRequest:
    - lifecycle = resolveJobLifecycle(PO_ROOT or DATA_DIR, jobId)
    - If null → return 404 or consistent empty list (choose one; prefer 404 for “job not found”)
    - baseDir = jobDir for lifecycle
    - taskDir = baseDir/tasks/:taskId/:type
    - Remove fallbackTaskDir logic entirely.
    - Replace startsWith jail with path.relative-based check:
      - rel = path.relative(baseDir, resolved taskDir)
      - Block if rel startsWith("..") or path.isAbsolute(rel)
    - If taskDir missing → return empty list (200) or 404 by policy; match existing UX (previously empty list).
- Acceptance:
  - Only one lifecycle directory is used.
  - Fallback code removed; jail uses path.relative rule.
  - Endpoint returns same JSON shape as before.
- Conventional Commit:
  - refactor(ui-server): serve task file lists from single lifecycle with stricter path jail

<new_task>
<context>
Carry-over:

- Files list endpoint now single-lifecycle; fallback removed; safer jail applied.
- Existing clients unchanged (same endpoint/params/shape).
- Next: Apply analogous changes to file content endpoint.
  </context>
  </new_task>

## Step 3 — Refactor file endpoint to single-lifecycle serving

- Goal: Mirror list endpoint changes for content fetch.
- Actions:
  - In handleTaskFileRequest:
    - lifecycle = resolveJobLifecycle(...)
    - If null → 404 (job not found)
    - baseDir = jobDir for lifecycle
    - filePath = baseDir/tasks/:taskId/:type/:filename
    - Keep pre-filters: reject traversal markers, absolute paths, Windows drive/backslashes
    - Use path.relative jail with baseDir against resolved filePath
    - If file missing → 404
    - Keep MIME/encoding/text/binary logic unchanged.
- Acceptance:
  - Only one lifecycle directory used.
  - Stricter jail enforced via relative check.
  - Response format unchanged.
- Conventional Commit:
  - refactor(ui-server): read task file content from single lifecycle and enforce relative-jail

<new_task>
<context>
Carry-over:

- Both endpoints now use single-lifecycle resolution with stricter jail.
- Fallback code is removed across both handlers.
- Next: Remove dead code/logs related to fallback and tighten any error messaging.
  </context>
  </new_task>

## Step 4 — Cleanup: remove fallback remnants and normalize responses

- Goal: Eliminate dead code and ensure consistent responses/logs.
- Actions:
  - Remove any unused variables/branches for fallback paths.
  - Normalize error messages to avoid disclosing filesystem internals.
  - Ensure status codes align with policy (e.g., 404 for missing job/file, 403 for jail violations).
- Acceptance:
  - No references to fallback directories remain.
  - Logs minimal; no sensitive paths leaked.
- Conventional Commit:
  - chore(ui-server): remove fallback remnants and normalize error handling

<new_task>
<context>
Carry-over:

- Code is simplified and clean; only single-lifecycle paths remain.
- Next: Add/adjust tests to cover lifecycle resolution & jail behavior deterministically.
  </context>
  </new_task>

## Step 5 — Tests: lifecycle + jail coverage

- Goal: Comprehensive, deterministic tests for the refactor.
- Actions:
  - Add/adjust server tests (e.g., ui.server.task-files.routing.test.js and ui.server.task-file.routing.test.js):
    - Resolves to current → lists/reads from current; never probes complete.
    - Resolves to complete → lists/reads from complete only.
    - Job not found → expected 404 (or policy-appropriate empty list for “files”).
    - Traversal attempts (../, absolute, backslashes) → 403.
    - Relative-jail ensures /foo/bar vs /foo/barista cannot bypass.
  - Keep client hook tests intact (useTaskFiles) as API shape didn’t change.
- Acceptance:
  - New tests pass deterministically with fake FS scenarios.
  - No flakiness or open handles.
- Conventional Commit:
  - test(ui-server): cover single-lifecycle resolution and strict relative-based jail

<new_task>
<context>
Carry-over:

- Tests added/updated; validate integration paths align with single-lifecycle behavior.
- Next: Run full suite and address any small regressions.
  </context>
  </new_task>

## Step 6 — Full test run and nit fixes

- Goal: Green build with stable suite.
- Actions:
  - Run full test suite; fix lints and minor issues if any.
  - Ensure no performance regressions or open handles.
- Acceptance:
  - All tests green consistently.
- Conventional Commit:
  - chore(repo): finalize single-lifecycle refactor with tests green

<new_task>
<context>
Carry-over:

- Build is green.
- Next: Document the new behavior for clarity and future contributors.
  </context>
  </new_task>

## Step 7 — Documentation: single-lifecycle behavior and jail policy

- Goal: Update storage and server docs.
- Actions:
  - docs/storage.md or docs/tasks-data-shape.md:
    - Endpoints serve from exactly one lifecycle directory determined at request time (current > complete > rejected precedence).
    - No fallback probing across lifecycles.
    - Path jail enforcement via path.relative; rationale and examples.
  - Brief migration note if any prior assumptions referenced fallback.
- Acceptance:
  - Clear docs with examples and rationale.
- Conventional Commit:
  - docs(ui-server): document single-lifecycle serving and tightened path jail

</detailed_sequence_of_steps>

<new_task>
<context>
Final handoff:

- Hotfix applied; lifecycle resolver added.
- Endpoints refactored to single-lifecycle serving with path.relative jail.
- Fallback logic removed; tests added; suite green.
- Docs updated to reflect behavior and security posture.
- Endpoints remain:
  - GET /api/jobs/:jobId/tasks/:taskId/files?type=artifacts|logs|tmp
  - GET /api/jobs/:jobId/tasks/:taskId/file?type=...&filename=...
- Environment: PO_ROOT respected; lifecycles current, complete, rejected detected via FS existence.
  </context>
  </new_task>
