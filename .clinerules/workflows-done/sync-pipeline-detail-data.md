<task_objective>
Extend the client hook to support server “state:change” SSE in addition to existing job:\* events and deliver production-ready code, tests, and optional docs with **zero human interaction**. The workflow must autonomously implement changes, run tests, validate behavior per Definition of Done, and **create a Conventional Commit after each step when applicable**.

Deliverables

- Code: src/ui/client/hooks/useJobDetailWithUpdates.js (add state:change handling, debounced refetch, small refactor to reuse fetch logic)
- Tests: tests/useJobDetailWithUpdates.test.jsx (3–4 new cases covering direct-apply, debounced refetch, pre-hydration queue, ignore unrelated)
- Optional docs: short note in docs/plans or README describing SSE compatibility (job:_ and state:_)

Definition of Done

- After loading /pipeline/:jobId, changing demo/pipeline-data/(current|complete)/{jobId}/tasks-status.json updates the UI without refresh.
- All existing tests remain green; new tests pass deterministically (no flakiness).
- Hook tolerates both job:_ and state:_ SSE events and avoids refetch storms.
- Reconnects preserve live updates.

Overview
Extend the client hook to subscribe to server’s “state:change” SSE in addition to existing job:\* events. When the payload contains job id and minimal fields, apply locally; otherwise debounce a targeted refetch for the active job. Preserve pre-hydration event queuing and existing reconnect logic.
</task_objective>

<detailed_sequence_of_steps>

1. Bootstrap & branch

- Verify that the current git branch is: rpm-sync-pipeline-detail-data

<new_task>
<context>
MEMORY_BANK (repeat in each step; authoritative)

- Path focus: src/ui/client/hooks/useJobDetailWithUpdates.js; tests/useJobDetailWithUpdates.test.jsx
- SSE: EventSource("/api/events"); listen to job:\* and state:change
- API refetch target: GET /api/jobs/:jobId
- Demo path to mutate: demo/pipeline-data/(current|complete)/{jobId}/tasks-status.json
- Env: PO_ROOT=demo
- Hydration: initial fetch → hydratedRef=true; pre-hydration events queued (eventQueue)
- Equality guard: prevent re-render if JSON snapshots equal
- Debounce: REFRESH_DEBOUNCE_MS = 200 (export for tests)
- Reconnect: central attachListeners() used on first connect + reconnect
- Ignore rule: events not matching current jobId and not referencing its tasks-status.json path
- Sample SSE payloads:
  - { "type":"state:change","id":"6seZRu98s38b","status":"running","progress":0.42 }
  - { "type":"state:change","path":"demo/pipeline-data/current/6seZRu98s38b/tasks-status.json" }

COMMIT_POLICY

- Use Conventional Commits. Types: feat, fix, refactor, perf, test, docs, chore, ci, build, style, revert.
- Scope suggestions: hooks, sse, ui, docs, tests.
- Subject: imperative, ≤50 chars, no trailing period.
- Body: why + what; wrap ~72 chars; reference tests/risks.
- Template:
  <type>(<scope>): <subject>

  <body: what changed, why, tests/notes>

  <footers if any>

- After each step: if code/tests/docs changed → create commit using the template; if no change → skip commit.

# Phase 1 completed:

- Repo is accessible; baseline tests pass.

# Next:

- Confirm SSE payload shape & identify broadcast paths; persist sample payload to tmp-payload.json (ephemeral; do not commit).

# Commit for this step: Not applicable unless files changed (typically skip).

</context>
</new_task>

2. Confirm SSE payload shape

- Inspect server SSE broadcast paths to verify "state:change" object structure (id and/or file path).
- DEBUG-only logs allowed during development; remove before commit.
- Acceptance: clear mapping of fields for direct-apply (id) vs path-only fallback.
- Write representative samples to tmp-payload.json (do **not** commit; add to .gitignore if needed).

<new_task>
<context>
MEMORY_BANK (repeat)

- Confirmed: state:change may include {id,...} (direct apply) or {path: ".../pipeline-data/(current|complete)/${jobId}/tasks-status.json"} (refetch).
- tmp-payload.json holds examples; untracked.

# Phase 2 completed:

- Verified payload fields; examples recorded.

# Next:

- Refactor fetch logic and add debounce scaffolding.

# Commit for this step:

- If .gitignore updated to exclude tmp-payload.json:
  Suggested:
  chore(repo): ignore tmp-payload.json payload samples

  Add tmp-payload.json to .gitignore to avoid committing ephemeral payload samples.
  </context>
  </new_task>

3. Refactor hook fetch logic & debounce infra

- Extract fetch-on-mount → fetchJobDetail(jobId, { signal }?)
- Add/export REFRESH_DEBOUNCE_MS = 200
- Add refs: refetchTimerRef, hydratedRef (if missing), needsRefetchRef, keep eventQueue
- Preserve equality safeguards
- Run tests (should remain green)

<new_task>
<context>
MEMORY_BANK (repeat)

- Refactor only; no behavior change expected.

# Phase 3 completed:

- fetchJobDetail extracted; debounce/refs scaffolded; tests green.

# Next:

- Register “state:change” listener + cleanup + reconnect.

# Commit for this step (apply if files changed):

refactor(hooks): extract fetchJobDetail and add debounce scaffolding

Move mount fetch into fetchJobDetail(jobId,{signal}) and export REFRESH_DEBOUNCE_MS=200.
Introduce refs (refetchTimerRef, hydratedRef, needsRefetchRef) and retain equality guards.
No behavior change; all tests remain green.
</context>
</new_task>

4. Attach “state:change” listener (and cleanup)

- In attachListeners, add addEventListener('state:change', onStateChange)
- Ensure cleanup removes it; reconnect reuses attachListeners
- DEBUG logs behind flag; remove before final commit

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 4 completed:

- Listener added; cleanup & reconnect verified.

# Next:

- Implement handleIncomingStateChange (direct-apply + debounced-refetch).

# Commit for this step:

feat(sse): attach state:change listener with cleanup and reconnect

Register onStateChange via addEventListener('state:change', …).
Ensure cleanup removes listener and reconnect path reattaches via attachListeners().
DEBUG logs gated for local verification.
</context>
</new_task>

5. Implement handleIncomingStateChange (two paths)

- Direct apply: payload.id === jobId → derive {type:'job:updated', payload}; queue if not hydrated; else apply
- Debounced refetch: path includes /pipeline-data/(current|complete)/${jobId}/tasks-status.json → schedule debounced fetch; clear existing timer first
- Ignore unrelated events

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 5 completed:

- Dual-path handler implemented.

# Next:

- Preserve/verify pre-hydration behavior.

# Commit for this step:

feat(hooks): handle state:change via direct apply or debounced refetch

If payload.id matches current jobId, convert to job:updated and apply/queue.
If path-only points to job’s tasks-status.json, schedule debounced fetch (clearing any pending timer).
Ignore unrelated events to prevent unnecessary work.
</context>
</new_task>

6. Preserve pre-hydration behavior

- If !hydratedRef: queue id-matched updates; set needsRefetchRef=true for path-only
- After first fetch: drain queue; if needsRefetchRef and not covered by queued update, do one debounced refetch
- Equality checks prevent double-apply

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 6 completed:

- Pre-hydration queue + post-hydration reconciliation wired.

# Next:

- Reconnect handling confirmations.

# Commit for this step:

feat(hooks): preserve pre-hydration queue and reconcile post-hydration

Queue id-matched updates pre-hydration and mark path-only hints for a single post-hydration debounced refetch.
Ensure reducer equality checks avoid double application.
</context>
</new_task>

7. Reconnection handling

- Reuse attachListeners on reconnect; verify listeners active again
- Ensure no leaks; continuity preserved

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 7 completed:

- Reconnect flow confirmed.

# Next:

- Equality & perf safeguards.

# Commit for this step (choose type based on actual change):

refactor(sse): centralize listener binding for reconnect stability

Consolidate listener setup in attachListeners() and invoke from initial connect and reconnect paths to prevent leaks and ensure state:change + job:\* remain active.
</context>
</new_task>

8. Equality & performance safeguards

- Keep stable-compare in setData; minimize merges
- Optionally expose REFRESH_DEBOUNCE_MS override for tests

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 8 completed:

- Equality/perf confirmed or minimally adjusted.

# Next:

- Add deterministic tests.

# Commit for this step (only if code changed):

perf(hooks): guard duplicate snapshots to reduce unnecessary renders

Retain/strengthen stable comparison in setData; constrain updates to active job detail.
</context>
</new_task>

9. Add tests (deterministic, no flakiness)

- Setup FakeEventSource; mock fetch; vi.useFakeTimers()
- Cases:
  1. Direct apply (id match) → no extra fetch
  2. Path-only → debounced refetch once
  3. Pre-hydration queue → applied after hydration
  4. Reconnect → state:change still updates
  5. Ignore unrelated (id/path mismatch)
- Existing tests remain green

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 9 completed:

- Tests added; suite green.

# Next:

- Manual demo validation.

# Commit for this step:

test(hooks): add deterministic cases for state:change direct apply and debounced refetch

Cover pre-hydration queue/apply, reconnect listener rebind, and ignore unrelated events.
Use FakeEventSource, mocked fetch, and fake timers for debounce determinism.
</context>
</new_task>

10. Manual end-to-end check in demo

- Run with PO_ROOT=demo; open /pipeline/:jobId
- Edit tasks-status.json; expect UI updates in ~1–2s
- Tweak debounce/handlers if needed and re-run tests

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 10 completed:

- Manual demo confirmed live updates.

# Next:

- Add documentation note.

# Commit for this step:

- Not applicable unless code or scripts were changed to support demo; otherwise skip.
  </context>
  </new_task>

11. Documentation

- Add note in docs/plans or README:
  - Consumes job:_ and state:_
  - Direct-apply needs payload.id; path-only triggers debounced refetch
  - Server encouraged to emit job:\*; path-only tolerated
  - Document expected fields (id, status, progress) and REFRESH_DEBOUNCE_MS

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 11 completed:

- Docs added.

# Next:

- Finalize: remove DEBUG, lint, full tests, prepare PR.

# Commit for this step:

docs(sse): document state:change handling and debounce fallback

Explain direct-apply vs path-only behavior, expected payload fields, and recommendation to emit job:\* events for parity.
</context>
</new_task>

12. Finalize & PR

- Remove DEBUG logs
- Run lints/formatters and full test suite
- Create PR with summary, risks, coverage

<new_task>
<context>
MEMORY_BANK (repeat)

# Phase 12 completed:

- All code, tests, docs finalized.

# Commit for this step (if any final code/doc cleanups occurred):

chore(repo): remove debug logs and run final formatting

Clean up development logging, apply formatters, and ensure all tests pass.

# PR message guidance (not a commit):

Provide a high-signal PR description summarizing scope, risks (reconnect, debounce storms), and deterministic test coverage.
</context>
</new_task>

</detailed_sequence_of_steps>
