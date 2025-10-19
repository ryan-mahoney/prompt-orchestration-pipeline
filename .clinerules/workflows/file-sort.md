<task_objective>
Implement a strict, category-based file model for task steps and refactor the UI to exclusively use that model—**from start to finish with zero human interaction**. The workflow must run on the **current branch** (no new branches), complete all steps autonomously, make pragmatic choices when tradeoffs arise, and **create a Conventional Commit at the end of each section**. It must: (1) assign each file a concrete category (artifacts, logs, tmp) based on `tasks_status.json` for the active step, (2) list **only** files from that step, (3) ensure tab filtering/toggling works by type, and (4) remove all “input/output” concepts. The script must carry forward key decisions between steps even as each step runs in a fresh context.
</task_objective>

<detailed_sequence_of_steps>

**Step 1 — Define the single source of truth (`task.files`)**

- What to change
  - Add a selector utility that enforces `task.files = { artifacts: string[], logs: string[], tmp: string[] }`.
  - Validate shapes, coerce absent keys to empty arrays, and reject legacy “input/output” or heuristic-based fields.

- Files likely touched
  - `src/utils/task-files.js` (new)
  - Optional: light JSDoc/typedef for structure

- Validation
  - Unit tests (if present) or lightweight checks to confirm it returns only the three arrays and only strings.

- Commit
  - Conventional Commit: **feat(core): add strict task-files selector and schema enforcement**

<new_task> <context>
Completed Work:

- Introduced strict `task.files` contract and selector utility.
- No legacy input/output allowed; all keys coerced to arrays of strings.

Key Decisions to Carry Forward:

- The UI may only consume `artifacts | logs | tmp` for the selected task step.
- If a step or files are missing, return `{ artifacts: [], logs: [], tmp: [] }`.

Next Step:

- Refactor JobDetail to consume the selector and remove input/output providers.

  </context>

</new_task>

**Step 2 — Replace JobDetail file providers with category-based selector**

- What to change
  - Remove `inputFilesForItem`/`outputFilesForItem`.
  - Add `filesByTypeForItem(item) → getTaskFilesForTask(job, item.id)` and pass to DAGGrid via a new prop.

- Files likely touched
  - `src/components/JobDetail.jsx`

- Validation
  - Confirm JobDetail no longer references input/output or filename heuristics.

- Commit
  - Conventional Commit: **refactor(ui): JobDetail uses category-based files provider**

<new_task> <context>
Completed Work:

- JobDetail now exposes `filesByTypeForItem(item)` using strict selector.

Key Decisions to Carry Forward:

- Downstream consumers (DAGGrid) must rely solely on `filesByTypeForItem`.

Next Step:

- Update DAGGrid to read files by active step and selected tab (artifacts/logs/tmp).

  </context>

</new_task>

**Step 3 — Refactor DAGGrid to use category files of the selected step**

- What to change
  - Replace legacy props with `filesByTypeForItem`.
  - For the open item, compute `{ artifacts, logs, tmp }` and list `allFilesForStep[filePaneType]`.
  - Remove all input/output logic and name-based heuristics.

- Files likely touched
  - `src/components/DAGGrid.jsx`

- Validation
  - Switching tabs changes lists deterministically; only the active step’s files appear.

- Commit
  - Conventional Commit: **refactor(ui): DAGGrid switches to per-step category tabs**

<new_task> <context>
Completed Work:

- DAGGrid lists only the current step’s files for the chosen tab (artifacts/logs/tmp).

Key Decisions to Carry Forward:

- No cross-step mixing; no heuristics; no input/output types.

Next Step:

- Ensure TaskFilePane receives correct type/filename and resets selection on tab changes.

  </context>

</new_task>

**Step 4 — Ensure TaskFilePane receives correct type/file; reset on tab change**

- What to change
  - When `filePaneType` changes, clear `filePaneFilename` to prevent stale selection.
  - (Optional) Auto-select first file after tab change for UX polish; otherwise require explicit click.
  - Verify TaskFilePane props: `isOpen, jobId, taskId, type=filePaneType, filename=filePaneFilename`.

- Files likely touched
  - `src/components/DAGGrid.jsx` (state handling)
  - `src/components/TaskFilePane.jsx` (prop expectations only; logic remains)

- Validation
  - Tab toggling updates the pane’s `type`; it only fetches when a new filename is set.

- Commit
  - Conventional Commit: **fix(ui): clear stale filename on tab change and enforce type-aligned fetches**

<new_task> <context>
Completed Work:

- Prevented stale filename carryover; ensured correct type/filename flow to TaskFilePane.

Key Decisions to Carry Forward:

- Fetch should occur only when filename is selected for the current tab’s category.

Next Step:

- Remove legacy input/output paths and heuristics across the project.

  </context>

</new_task>

**Step 5 — Remove legacy paths and concepts project-wide**

- What to change
  - Delete/replace all references to `inputFilesForItem`, `outputFilesForItem`, `file.type === "input" | "output"`, and any filename heuristics.
  - Remove use of legacy `task.artifacts` outside the new `files` schema.

- Files likely touched
  - Any component or helper referencing the old concepts

- Validation
  - Build passes and no references to legacy patterns remain.

- Commit
  - Conventional Commit: **chore(cleanup): remove input/output concepts and filename heuristics**

<new_task> <context>
Completed Work:

- Purged input/output constructs and heuristic matching across UI.

Key Decisions to Carry Forward:

- The only valid interface is `task.files.{artifacts,logs,tmp}` via the selector.

Next Step:

- Add focused tests to validate filtering and per-step isolation.

  </context>

</new_task>

**Step 6 — Add focused tests for filtering, categories, and per-step isolation**

- What to change
  - New test covering: default tab shows artifacts only; switching to Logs/Temp shows only those; clicking a file opens TaskFilePane with matching type.
  - Update JobDetail tests to assert it passes **only** current step’s files and no legacy fallbacks.

- Files likely touched
  - `tests/DAGGrid.task-files-filtering.test.jsx` (new)
  - `tests/JobDetail.task-files-fix.test.jsx` (update)

- Validation
  - Tests pass deterministically; no reliance on heuristics or legacy shapes.

- Commit
  - Conventional Commit: **test(ui): add category filtering and per-step isolation coverage**

<new_task> <context>
Completed Work:

- Added tests for category tabs and step scoping; JobDetail tests updated.

Key Decisions to Carry Forward:

- Category-only model validated via tests.

Next Step:

- Add wiring tests for TaskFilePane lifecycle (tab change resets; fetch after selection).

  </context>

</new_task>

**Step 7 — Harden TaskFilePane wiring with tab/filename lifecycle tests**

- What to change
  - Test that tab change clears filename; no fetch until filename is reselected; after selection, it fetches with matching `type` and `filename`.

- Files likely touched
  - `tests/TaskFilePane.wiring.test.jsx` (new)

- Validation
  - Deterministic behavior: no stale fetches; correct query pairs.

- Commit
  - Conventional Commit: **test(ui): add TaskFilePane lifecycle tests for tab/filename changes**

<new_task> <context>
Completed Work:

- TaskFilePane lifecycle verified (no stale fetch; correct type/filename pairing).

Key Decisions to Carry Forward:

- Empty states must be graceful; no crashes if files are absent.

Next Step:

- Add small guards and clear empty-state messages.

  </context>

</new_task>

**Step 8 — Developer ergonomics: guards and empty states**

- What to change
  - In the selector, gracefully return empty arrays when step missing; optionally warn in dev.
  - In DAGGrid, show “No {tab} files found” when a list is empty.

- Files likely touched
  - `src/utils/task-files.js`
  - `src/components/DAGGrid.jsx`

- Validation
  - No crashes on missing data; clear messaging in the slide-over list.

- Commit
  - Conventional Commit: **feat(devx): add guards and empty-state messages for task files**

<new_task> <context>
Completed Work:

- Added guards and user-friendly empty states.

Key Decisions to Carry Forward:

- The simplified model is now robust for missing/empty data.

Next Step:

- Update docs to align with the simplified, category-only file model.

  </context>

</new_task>

**Step 9 — Documentation touch-up**

- What to change
  - Update developer docs to state: UI consumes `task.files.{artifacts,logs,tmp}` only; no input/output; tabs directly map to categories; lists are step-scoped.

- Files likely touched
  - `docs/storage.md` or `docs/tasks-data-shape.md`

- Validation
  - Docs accurately reflect the enforced contract and UI flow.

- Commit
  - Conventional Commit: **docs: clarify category-only task files model and UI behavior**

<new_task> <context>
Completed Work:

- Documentation aligned with new model and UI assumptions.

Key Decisions to Carry Forward:

- Project treats category-only `task.files` as the single source of truth.

Next Step:

- Final sweep: remove dead code, run full test suite, lint, and verify behavior end-to-end.

  </context>

</new_task>

**Step 10 — Final sweep and verification**

- What to change / verify
  - Run the full test suite; fix lints; verify no references to removed props/functions.
  - Manual sanity check: slide-over lists only files for active step; tab filtering is deterministic; no input/output artifacts remain.

- Validation
  - All tests green; build and lint pass; UX behaves as specified.

- Commit
  - Conventional Commit: **chore: final cleanup, lint fixes, and verification of category-based files**

</detailed_sequence_of_steps>
