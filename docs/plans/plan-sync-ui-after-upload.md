Here’s what the SSE layer is doing now, why the UI doesn’t update after a seed upload, and a function-style, minimal, step-by-step plan to make the UI reflect changes immediately with tests at each step.

What the current SSE code is doing

Server-side

- Watcher: src/ui/watcher.js uses chokidar to watch paths, normalizes file changes to job-level changes via detectJobChange(), and calls sseEnhancer.handleJobChange().
- SSE Enhancer: src/ui/sse-enhancer.js debounces per jobId, reads the full job detail with readJob(jobId), then emits:
  - sseRegistry.broadcast({ type: "job:updated", data: detail })
- Upload path: src/ui/server.js handleSeedUpload() emits sseRegistry.broadcast({ type: "seed:uploaded", data: { name } }) on successful upload. It no longer pushes a full-state over SSE; clients bootstrap via GET /api/state and then rely on “incremental” SSE events. There’s also broadcastStateUpdate that emits state:change/summary, but the client hook is not listening for those.
- SSE transport: src/ui/sse.js manages the registry and writing SSE events with event: <type> and data: <json>.

Client-side

- Snapshot fetch: src/ui/client/hooks/useJobList.js fetches /api/jobs and returns the list.
- Live updates: src/ui/client/hooks/useJobListWithUpdates.js hydrates localData from useJobList(), then listens to SSE events:
  - job:created, job:updated, job:removed, status:changed
  - applies them via pure reducer applyJobEvent(prev, event) that merges by job.id and sorts, returning prev if no actual change (to avoid unnecessary re-renders).
- Importantly, the client does NOT listen for seed:uploaded or state:change/summary.

Why the UI doesn’t reflect the new job after uploading a seed

- On seed upload, the server emits seed:uploaded. The client doesn’t subscribe to this event, so nothing happens.
- The job directory does get created in pipeline-data/current/...; the watcher should eventually emit job:updated once files appear (seed.json, tasks-status.json, etc.). But this can be delayed or missed depending on:
  - chokidar is watching relative paths WATCHED_PATHS = "pipeline-config,pipeline-data,runs" relative to process.cwd(). If PO_ROOT points elsewhere in dev/demo runs, the watcher may not be monitoring the actual pipeline-data location. If so, job:updated never fires.
  - Even if watcher is correct, the initial creation can race the client hydration. The hook does queue pre-hydration events, but it only queues the known job:\* event types. A seed:uploaded is ignored; state:change is also ignored. So the first visible signal of “a new job exists” might not reach the client until a later watcher event or a manual refetch.

Goal

- Immediately reflect a new or updated job in the UI as soon as the underlying data changes, without requiring a full page refresh.

Plan → Do → Check (iterative, test-first), functional/minimal

Step 1: Close the event-type gap for seed uploads

- Plan:
  - Add a client handler for seed:uploaded that triggers a lightweight refetch of /api/jobs. This avoids inventing a new job:created payload format on the server and uses existing plumbing.
  - Keep reducer pure; avoid coupling seed:uploaded to job creation details (server currently only sends { name }).
  - Tests: add a unit test to useJobListWithUpdates.test.jsx that dispatches seed:uploaded and asserts that refetch was called (we’ll inject a mock refetch via the mocked useJobList base hook).
- Do:
  - Modify useJobListWithUpdates.js to addEventListener("seed:uploaded", onSeedUploaded) and call refetch() when received (queueing isn’t needed since refetch is idempotent).
- Check:
  - Run only this test; ensure it passes. Existing tests for job:created/updated remain green.
- Risks & mitigations:
  - Refetch spam if server emits multiple seed:uploaded in quick succession: mitigate by debouncing refetch in the hook (e.g., single timer with 250–500ms window).
  - If /api/jobs returns slowly, ensure hook keeps prior data during loading to avoid flicker (it already does).

Step 2: Ensure the watcher observes the correct pipeline-data directory

- Plan:
  - Confirm WATCHED_PATHS resolve against PO_ROOT. Today chokidar is started with raw paths ["pipeline-config","pipeline-data","runs"] relative to process.cwd(). In demo runs, PO_ROOT likely points to demo/..., so the server’s watcher might not be monitoring the demo’s pipeline-data directory.
  - Update initializeWatcher() to pass absolute paths (path.join(PO_ROOT, <subdir>)) to watcher.start.
  - Tests:
    - Integration test that starts the server with a temp PO_ROOT and asserts that writing demoDir/pipeline-data/current/<job>/seed.json leads to a job:updated SSE within debounce window. This likely builds on tests/sse-server.test.js or ui.server.\* tests. If too heavy, add a unit test for watcher.start that asserts chokidar.watch is invoked with absolute paths based on a mocked PO_ROOT.
- Do:
  - Resolve WATCHED_PATHS to absolute using the same resolvePipelinePaths/PO_ROOT used elsewhere or path.resolve(PO_ROOT, dir).
- Check:
  - Verify existing sse-server tests remain green; add new targeted test if needed.
- Risks & mitigations:
  - Cross-platform paths (Windows backslashes). detectJobChange() already normalizes, and chokidar accepts absolute paths; unit tests should simulate both separators.

Step 3: Emit job:created when a new current/<jobId> appears

- Plan:
  - Improve feedback time by emitting job:created as soon as we can read a minimal job detail after a new job folder or seed.json is first observed. The client reducer already handles job:created.
  - Implement in sse-enhancer: track first-seen jobId; when first time we can read job detail (res.ok) for a job not in a “seen” set, broadcast job:created instead of job:updated (then thereafter job:updated).
  - Tests:
    - Unit test for createSSEEnhancer: simulate readJob ok and ensure first call emits job:created, the next emits job:updated; ensure failures don’t mark “seen”.
- Do:
  - Extend createSSEEnhancer with a Set seen; on runJobUpdate(jobId), choose event type accordingly.
- Check:
  - Run new tests and existing hook tests; hook already listens to job:created so no UI change needed.
- Risks:
  - Double-emission if watcher coalesces multiple events; debounce exists. Keep debounce per jobId to avoid flooding.

Step 4: Map server “state-level” events to list updates (optional hardening)

- Plan:
  - The server emits broadcastStateUpdate which sends state:change/summary. We can choose to either:
    - Ignore (if Steps 1–3 fix UX), or
    - Treat state:change as a prompt to refetch if not on a tight loop (debounced).
  - Tests:
    - Unit test that state:change triggers a debounced refetch.
- Do:
  - If enabled, add onStateChange that schedules refetch with debounce (distinct timer from seed:uploaded).
- Check:
  - Validate rate limiting by test (multiple events -> single refetch).
- Risks:
  - Excess refetches; rely on debounce.

Step 5: Debounce refetch inside hook

- Plan:
  - Add a simple debounce util inside the hook to coalesce refetch calls from seed:uploaded and optional state:change within 300ms.
  - Tests:
    - Verify that two seed:uploaded in quick succession leads to one refetch call.
- Do:
  - Use a ref timer; cancel/restart on each trigger; call base.refetch() on fire.
- Check:
  - Tests green.

Step 6: E2E smoke test for upload → visible job

- Plan:
  - Add an e2e test that:
    - Starts server with temp PO_ROOT
    - POSTs /api/upload/seed with a valid JSON seed
    - Waits (poll or SSE) until /api/jobs contains the job
  - This validates wiring end-to-end (upload → file → watcher → sse-enhancer → SSE → client refetch).
- Do:
  - Reuse tests/utils/startServer and helpers; keep timeouts conservative to avoid flakiness.
- Check:
  - Ensure it passes locally.

Step 7: Small DX refinements (optional)

- Plan:
  - Add console.debug in server when emitting seed:uploaded, job:created/updated for traceability in dev. Keep production logs minimal.
  - Update docs/plan-always-sse.md or docs/project-seed-upload.md to note “client listens for seed:uploaded and refetches /api/jobs.”

Acceptance checklist

- On successful seed upload, the UI reflects the new job in the list without a manual refresh.
- When a job directory or status file changes, the UI updates the existing job entry promptly.
- No duplicate entries; ordering remains consistent (sortJobs).
- Refetch calls are debounced to avoid flooding.
- Works when PO_ROOT points to a non-CWD demo/data directory.

Concrete file changes (planned)

- src/ui/client/hooks/useJobListWithUpdates.js
  - Add listeners for seed:uploaded (and optional state:change).
  - Add a small debounce for refetch triggers.
- src/ui/sse-enhancer.js
  - Track first-seen job IDs; emit job:created on first successful read.
- src/ui/server.js (initializeWatcher)
  - Resolve WATCHED_PATHS to absolute based on PO_ROOT to ensure chokidar watches the correct directories.
- tests/useJobListWithUpdates.test.jsx
  - Add tests for seed:uploaded → refetch, and refetch debounce.
- tests/sse-enhancer.test.js
  - Add tests for first-seen job → job:created, subsequent → job:updated.
- New or updated integration/e2e test
  - Validate end-to-end upload-to-UI visibility.

Testing notes and guardrails (applied each step)

- Keep tests unit-level where possible, with deterministic behavior.
- Spy on module objects (e.g., vi.spyOn(baseHookModule, 'useJobList') if needed) not destructured bindings.
- Clean up timers and mocks in afterEach; avoid hanging handles.
- For debounce behavior, use vi.useFakeTimers in those specific tests to advance time deterministically.

Why this is minimal and function-style

- We do not introduce global mutable state on the client; changes live inside the hook via refs and pure reducers.
- We leverage existing hooks and SSE events, only adding a minimal bridge (seed:uploaded → refetch) and an incremental server improvement (job:created event) for immediate UX.
- We avoid pushing full state over SSE; use /api/jobs snapshot plus small, typed events.

If you approve this plan, toggle to Act mode and I’ll implement Steps 1–3 with tests first, then evaluate if Step 4 is necessary based on the test outcomes.

Implementation status

- [x] Step 5: Debounce refetch inside hook — implemented and verified (tests pass)

Notes:

- No code changes were required for Step 5; the `useJobListWithUpdates` hook already implements `seed:uploaded` and `state:change` listeners and a debounced `refetch()` (REFETCH_DEBOUNCE_MS = 300).
- Full test suite ran locally (`npm test`) and passed.
- Next: If you want, I can commit this change following the repository's `.clinerules` conventional commit format.
