# Plan: Remove demo data usage from runtime (demo mode = paths only)

Goal

- Ensure the application never injects in-memory "demo" data into the UI or APIs.
- Preserve the repo's demo folder structure as a filesystem-backed example (PO_ROOT=demo) that the server can read when configured, but do not use src/data/demoData.js at runtime.
- Update tests so they validate real-data flows (filesystem-backed adapters / API / SSE) and remove any expectations that the UI will fall back to demo arrays.

Acceptance criteria (definitive)

- [ ] No runtime import or usage of `src/data/demoData.js`.
- [ ] UI and server do not fall back to in-memory demo arrays. When the server returns no jobs, the UI shows neutral/empty state or an error — not demo jobs.
- [ ] Banner or copy that says "Using demo data (live API unavailable)" is removed.
- [ ] Demo folder structure (demo/) remains usable by configuring paths (PO_ROOT=demo) and reading files via existing readers; demo is an on-disk seed, not a UI fallback.
- [ ] All tests updated: no mocks of `src/data/demoData.js`; tests that relied on demo data are replaced with small filesystem fixtures or explicit mock responses from server adapters.
- [ ] Repo-wide search for demoData/demoJobs/demoPipeline shows only docs or deleted references (no runtime code).

Plan (minimal, step-by-step)
Each step lists the change, the tests to update or add, and a recommended Conventional Commit subject.

Step 1 — Remove client fallback to demo arrays (UI)

- Files to change:
  - src/pages/PromptPipelineDashboard.jsx
- Work:
  - Remove import: `import { demoPipeline, demoJobs } from "../data/demoData";`
  - Remove the effect that sets `pipeline` from `demoPipeline`.
  - In the jobs selection logic, remove the branch that returns `demoJobs`. Always use `apiJobs` (adapted by `adaptJobSummary`) or an empty list.
  - Remove or replace UI copy that references demo fallback. (Either remove the banner or show a neutral error/empty message.)
- Tests to update:
  - tests/PromptPipelineDashboard.test.jsx
    - Remove `vi.mock("../src/data/demoData", ...)`.
    - Replace tests that asserted the demo banner or that demo rows are injected with tests that:
      - Assert an empty job list is rendered when hook returns [] (no demo injection).
      - Assert a neutral error message is rendered when the API hook returns an error (no demo injection).
    - Keep tests for filtering, progress calculations, and table rendering, but feed data via the job hook mock or by seeding a tiny temp filesystem fixture and mocking server fetch in integration tests.
- Commit message:
  - feat(ui): remove demo array fallback in PromptPipelineDashboard

Step 2 — Delete the demo data module

- Files to change:
  - Remove: src/data/demoData.js
  - Remove references in docs or rename references to "demo seed data" (docs only)
- Tests to update:
  - Ensure no tests import or mock `src/data/demoData.js`. Update any test fixtures that relied upon it to use:
    - Inline small fixtures in test files, or
    - Per-test temp dirs + file-based fixtures (preferred per .clinerules)
- Commit message:
  - chore(deps): remove src/data/demoData.js and update tests

Step 3 — Constrain "demo mode" to path configuration only

- Files to inspect:
  - src/ui/config-bridge.js
  - src/ui/config-bridge.browser.js
- Work:
  - Keep `CONFIG.useRealData` (or similar flags) as a pure configuration flag that controls path selection (server-side) or logging level, but do NOT use it in the UI to select demo arrays.
  - Document in comments that useRealData only controls where the server reads files (PO_ROOT) — not UI-side data substitution.
- Tests to update:
  - tests/config-bridge.test.js can remain but add a comment asserting the flag is only a config toggle and not used for data substitution.
- Commit message:
  - docs(config): clarify demo flag meaning (paths only, not UI fallback)

Step 4 — Ensure server and data readers always provide real data (or empty)

- Files to inspect/change (if needed):
  - src/ui/server.js
  - src/ui/state-snapshot.js
  - src/ui/job-reader.js / src/ui/job-scanner.js
  - src/ui/client/hooks/useJobListWithUpdates.js (client hook should only read from API/SSE)
- Work:
  - Confirm server endpoints read from filesystem paths defined through `PATHS`/config and do not import demo arrays.
  - If any server code imports `src/data/demoData.js`, remove it.
- Tests to update:
  - tests/job-endpoints._ and tests/ui.server._: add or update tests to assert the endpoint returns an empty list or filesystem-derived list when PO_ROOT=demo or when the directory is empty. Use per-test temp directories for file-based fixtures (`tests/utils/createTempPipelineDir.js`).
- Commit message:
  - fix(api): ensure endpoints return filesystem-backed job lists only

Step 5 — Replace demo-dependent tests with filesystem-backed fixtures and module-object spies

- Work:
  - For any tests previously relying on demoData, replace with:
    - Small JSON files placed in per-test temp dirs and cleaned up in afterEach OR
    - Inline object fixtures used only in the test that simulate what the adapter would return, but do not import demoData.
  - When spying on modules, follow testing-guardrails: spy on module objects (not destructured functions).
  - Ensure any console assertions match call arity.
- Tests to add:
  - Unit tests for adapters that read files: verify normalization of file shapes and that adapters return empty arrays when no files are present.
- Commit message:
  - test(fixtures): switch demoData tests to filesystem-backed fixtures

Step 6 — Documentation cleanup and guidance

- Files to update:
  - docs/react-tailwind-radix.md
  - docs/architecture.md (Demo Data section)
  - docs/llm_workflow_dashboard_split_files.md
  - docs/tasks-data-shape.md
- Work:
  - Update docs to state that demo is a filesystem seed (demo/) and that UI will never show fake arrays. Provide brief instructions for running demo mode by setting PO_ROOT=demo or environment flags for the server only.
- Commit message:
  - docs: update demo guidance — demo = filesystem seed, not UI fallback

Step 7 — Final verification and cleanup

- Work:
  - Run a repo-wide search to confirm no runtime imports of demo arrays remain.
  - Run test suite: `npm test` or the project's test command (see package.json). Fix any failing tests created by the change.
- Commands:
  - npm test
  - npm run lint (if applicable)
- Commit message:
  - test: update snapshots and finalize no-demo-data changes

Implementation notes & testing guardrails

- Per .clinerules:
  - Use per-test temp directories for file-system tests and remove them in afterEach.
  - Spy on module objects (vi.spyOn(moduleObj, "fn")), not destructured functions.
  - Ensure console assertions match argument arity.
  - Tests should be deterministic; avoid time-dependent flakiness. Use `vi.useFakeTimers()` when asserting timers.
- Where to seed tests:
  - Prefer tests/utils/createTempPipelineDir.js helper for creating demo-style file structures for tests (see tests/utils/).
  - Keep fixtures small and deterministic (one or two jobs) to assert filters and counts.
- UI behavior decisions (explicit)
  - When API returns [], the UI should show an empty state (no jobs) — no fake jobs should be displayed.
  - When the API returns an error, the UI shows a neutral error message component (e.g., "Unable to load jobs") — do not indicate demo data will be used.
  - The pipeline badge (pipeline.name) should only render when a pipeline object is available from a real source. Omitting the badge is acceptable until an endpoint for pipeline metadata exists.

Examples: Tests to update (concrete)

- tests/PromptPipelineDashboard.test.jsx
  - Replace the demo fallback test with:
    it("shows empty state when API returns empty list", async () => {
    useJobListWithUpdates.mockReturnValue({ data: [], loading: false, error: null, connectionStatus: "connected" });
    render(<PromptPipelineDashboard />);
    expect(screen.queryByText("Using demo data")).toBeNull();
    expect(screen.getByText("No jobs found")).toBeTruthy(); // adapt to your actual empty-state text
    });
  - For error case:
    it("shows neutral error when API errors", async () => {
    useJobListWithUpdates.mockReturnValue({ data: null, loading: false, error: { message: "fail" }, connectionStatus: "disconnected" });
    render(<PromptPipelineDashboard />);
    expect(screen.queryByText("Using demo data")).toBeNull();
    expect(screen.getByText(/Unable to load jobs/i)).toBeTruthy();
    });

- Integration tests for endpoints:
  - Create temp pipeline dir with one job file, start server or call handler, assert /api/jobs returns that job's normalized shape.

Commit strategy

- Make each step a small focused commit following Conventional Commits:
  - feat(ui): remove demo array fallback in PromptPipelineDashboard
  - chore(deps): remove src/data/demoData.js
  - fix(api): ensure endpoints return filesystem-backed job lists only
  - test(fixtures): switch demoData tests to filesystem-backed fixtures
  - docs: update demo guidance — demo = filesystem seed, not UI fallback

Risks & mitigations

- Breaking UI that expected demo content:
  - Mitigation: update tests and snapshots; communicate that badge or sample content may be absent without a seeded demo directory.
- Flaky tests due to filesystem state:
  - Mitigation: use per-test temp dirs and cleanup in afterEach.
- Unintended remaining references:
  - Mitigation: final repo-wide search for demoData/demoJobs/demoPipeline before merging.

Next action I will take (if you want me to proceed)

- Implement Step 1 and Step 2 in small commits, and update tests accordingly.
- Run the test suite and fix failures.

If you'd like me to implement the changes now, toggle to Act mode (you already did) — I can begin by writing this plan file (done) and then apply Step 1 in a follow-up commit.
