<task_objective>
Implement scoped file I/O for pipeline tasks end-to-end **with zero human interaction**. The workflow must autonomously run from start to finish, automatically choosing pragmatic approaches, creating/renaming files as needed, updating tests, updating docs, and validating via automated checks. Each step runs in a fresh context; therefore, the workflow must **carry forward** key decisions, paths, and schema details between steps. Each section ends with a Conventional Commit. Acceptance targets:

- Each queued task gets `files` APIs (artifacts/logs/tmp) scoped to its job+task, updating `tasks-status.json`.
- New storage layout: `tasks/{task}/artifacts/`, `tasks/{task}/logs/`, `tasks/{task}/tmp/`.
- `tasks-status.json` has top-level `files` and per-task `files` (arrays for artifacts/logs/tmp).
- Default write modes: artifacts=replace, logs=append, tmp=replace.
- Runner injects file functions per stage; any write records filenames at job and task levels.
- UI, adapters, API all consume `files.*` (no legacy `artifacts`), tests updated and passing.
- Docs, demo, and migration helper updated; automated end-to-end validation passes.
  </task_objective>

<detailed_sequence_of_steps>

# Preliminaries (carry these across steps)

- Branch name: `feat/core/scoped-file-io`.
- Paths & terms used below:
  - `workDir`: job directory (e.g., `pipeline-data/(pending|current|complete)/{jobId}`).
  - `statusPath`: absolute path to that job’s `tasks-status.json`.
  - `taskDir`: `workDir/tasks/{taskName}`; subdirs: `artifacts/`, `logs/`, `tmp/`.

- New schema: both job-level and task-level

  ```
  files: {
    artifacts: string[], logs: string[], tmp: string[]
  }
  ```

- Environment for demos: `PO_ROOT=demo`.
- Testing convention: per-test temp dirs; deterministic, non-flaky.

---

## Step 0 — Create feature branch and record baseline

**Goal:** Start `feat/core/scoped-file-io` and capture baseline status (no code changes).
**Actions:** Create the branch; record current test status and note that legacy `artifacts` arrays will be removed later.
**Conventional Commit:** `chore: start branch feat/core/scoped-file-io and record baseline`

<new_task>
Context for next step:

- Branch `feat/core/scoped-file-io` exists.
- Baseline tests pass with legacy `artifacts` usage.
- Proceed to add a functional file I/O module (no global state; curried factories; uses fs promises).
  </new_task>

---

## Step 1 — Add functional file I/O module with `files.*` updates

**Goal:** Provide curried, stage-scoped writers/readers that ensure directories on first use and update `tasks-status.json` on every write (de-duped arrays at job and task levels).
**What to implement (describe, no code):**

- Factory: `createTaskFileIO({ workDir, taskName, getStage, statusPath })` returning:
  - `writeArtifact(name, content, { mode="replace" })`
  - `writeLog(name, lineOrContent, { mode="append" })`
  - `writeTmp(name, content, { mode="replace" })`
  - `readArtifact(name)`, `readLog(name)`, `readTmp(name)`

- Behavior:
  - Resolve `taskDir` and subfolders (`artifacts/`, `logs/`, `tmp/`); create on demand.
  - Modes: replace = write; append = append; defaults above.
  - After any write, update `tasks-status.json` job-level and `tasks[taskName].files.*` arrays; de-dup entries.

- Tests (unit): temp dir per test; verify directory creation, mode behavior, de-dup, read-backs, and JSON updates.
  **Conventional Commit:** `feat(core): add stage-scoped curried file IO with status updates`

<new_task>
Carry-over:

- New module: `createTaskFileIO` as described.
- Tests for IO behaviors are passing.
  Next: inject `files` API into each stage invocation via task runner.
  </new_task>

---

## Step 2 — Inject `files` API into stage context (task-runner)

**Goal:** Ensure every stage receives bound `context.files` from `createTaskFileIO`.
**What to change (describe):**

- In the task-runner’s stage invocation, construct a per-task singleton via `createTaskFileIO({ workDir, taskName, getStage: () => context.currentStage, statusPath })`.
- Before calling the stage function, set `context.files = fileIO`.
- Do not otherwise alter logging/telemetry.
- Tests (integration-lite): a dummy stage calls `context.files.writeArtifact("out.json","{}")`; verify file and `tasks-status.json` updates.
  **Conventional Commit:** `feat(core): inject stage-scoped files API into task context per stage`

<new_task>
Carry-over:

- `context.files` now available in stages.
- IO module and tests remain green.
  Next: route pipeline outputs via the new writers; stop legacy `artifacts` enumeration.
  </new_task>

---

## Step 3 — Route pipeline outputs through file IO; prepare new schema

**Goal:** The pipeline-runner passes `statusPath` into context, ensures task folders exist, and writes outputs/logs via `context.files` (not via legacy paths).
**What to change (describe):**

- Add `statusPath` to the context the runner builds.
- On task start, ensure `taskDir` exists; do **not** pre-create legacy files.
- After pipeline returns, if there’s `context.output`, write it with `context.files.writeArtifact("output.json", ...)`.
- For run logs, prefer one consolidated write via file IO rather than separate legacy files.
- Remove legacy `artifacts` enumeration/writes.
- Update tests accordingly (runner expectations based on `files.*`).
  **Conventional Commit:** `refactor(core): route task outputs through file IO and use new files schema`

<new_task>
Carry-over:

- Runner now writes via IO module; legacy `artifacts` writes removed.
- `statusPath` present in context.
  Next: document schema; keep validation minimal to avoid blocking demo.
  </new_task>

---

## Step 4 — Document new schema; adjust validator (minimal)

**Goal:** Document top-level and per-task `files.*` objects; relax any validation that enforced legacy `artifacts`.
**What to change (describe):**

- Update docs (`storage.md`, `tasks-data-shape.md`) to define `files.artifacts|logs|tmp` arrays and removal of legacy `artifacts`.
- If a validator exists, make `files.*` optional arrays; remove requirements around legacy `artifacts`.
- Update any tests asserting the old shape.
  **Conventional Commit:** `docs(storage): document new files schema for job and tasks`

<new_task>
Carry-over:

- Schema documented; validators (if any) aligned.
  Next: switch UI/adapters/transformers to consume `files.*` with no backward compatibility.
  </new_task>

---

## Step 5 — Switch UI & adapters to `files.*` (breaking: remove legacy `artifacts`)

**Goal:** UI exclusively reads `task.files.artifacts` (fallback `[]` if absent) and never uses legacy `artifacts`.
**What to change (describe):**

- In job adapters/transformers, stop reading `t.artifacts`; use `t.files?.artifacts`.
- In components (e.g., JobDetail, DAG/Grid), list files from `task.files.artifacts`.
- Update UI tests (adapters, transformers, components) to assert the new shape.
  **Conventional Commit:** `feat(ui)!: consume files.* for task files and remove legacy artifacts`

<new_task>
Carry-over:

- UI and adapters now depend solely on `files.*`.
- Tests updated accordingly.
  Next: update one demo task to showcase the new API.
  </new_task>

---

## Step 6 — Update demo task to use `context.files` (append logs, replace artifacts)

**Goal:** Demonstrate default modes and status updates in a real task.
**What to change (describe):**

- Modify one demo task stage to:
  - Write an artifact (e.g., `synthesis.json`) via `writeArtifact`.
  - Append a line to `execution.log` via `writeLog`.

- Integration test: run minimal demo pipeline in temp dir with mocked dependencies; assert files exist and `tasks-status.json` has correct arrays at job and task levels.
  **Conventional Commit:** `feat(demo): write artifacts and logs via stage-scoped files API`

<new_task>
Carry-over:

- Demo exercises IO module.
- Integration test passes.
  Next: ensure API endpoints surface `files.*` consistently (breaking change).
  </new_task>

---

## Step 7 — Update API endpoints to return `files.*` (breaking)

**Goal:** Job detail and any summaries expose `tasks[].files` and no legacy `artifacts`.
**What to change (describe):**

- Update job-detail endpoint (and any summaries) to include `files.*` and remove legacy fields.
- Update API integration tests to assert presence of `files` and absence of legacy `artifacts`.
  **Conventional Commit:** `feat(api)!: return files.* in job detail and remove legacy artifacts`

<new_task>
Carry-over:

- API returns new shape; UI already consumes it.
  Next: provide a one-shot migration helper for existing demo data.
  </new_task>

---

## Step 8 — Add migration helper for demo data

**Goal:** Move legacy outputs/logs into new task subfolders and rewrite `tasks-status.json` to the new `files` schema.
**What to change (describe):**

- Script scans `pipeline-data/(current|complete)/*/tasks/*`:
  - Move `output.json` → `artifacts/output.json` (if present).
  - Move `execution-logs.json` → `logs/execution-logs.json` (append/replace sensibly).
  - Move `letter.json` → `artifacts/letter.json` (if present).
  - Rewrite `tasks-status.json`: remove legacy `artifacts`, add `files.*` arrays at job and task levels.

- Sanity tests: run script in a temp copy and assert the resulting shape and file placements.
  **Conventional Commit:** `chore(scripts): add migration script for files schema and layout`

<new_task>
Carry-over:

- Migration script available.
- Everything now aligned on `files.*`.
  Next: replace the manual test with **automated end-to-end validation** and update docs succinctly.
  </new_task>

---

## Step 9 — Automated end-to-end validation & doc touch-ups (no human actions)

**Goal:** Prove the full path (runner → stage files IO → API → UI) via automated checks; finalize concise docs.
**What to do (describe):**

- Run the full test suite (unit + integration + UI), ensuring deterministic pass.
- Spin up demo in a temp workspace with `PO_ROOT=demo`, execute a minimal pipeline, poll job detail through the API, and assert:
  - Files exist under `tasks/{task}/(artifacts|logs|tmp)`.
  - `tasks-status.json` has `files.*` arrays at job+task levels and updates after writes.
  - UI-side adapter renders the file list from `files.artifacts`.

- Update README/docs with a short “Verification” section describing how the system now works and what changed (legacy field removed).
  **Conventional Commit:** `docs: add automated verification notes and finalize files.* migration`

</detailed_sequence_of_steps>

<new_task>
Final handoff summary:

- Feature branch: `feat/core/scoped-file-io`.
- New `files.*` schema documented and enforced across core, API, UI, demo.
- IO module in place; runner and stages use it; breaking changes applied where noted.
- Migration helper included; all tests green; automated end-to-end validation completed.
- Proceed to open PR and request review per repo standards.
  </new_task>
