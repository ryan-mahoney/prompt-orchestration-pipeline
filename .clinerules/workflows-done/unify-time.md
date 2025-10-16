<task_objective>
Implement a unified, policy-driven duration system across JobTable, JobCard, and JobDetail with tests and documentation — completing every step autonomously with **no human interaction**. The workflow must: add duration utilities, integrate a reactive ticker, update all consumers to the new policy (including “rejected” handling and state normalization), harmonize UI microcopy, and deliver deterministic tests. **Each step must stage changes and make a git commit**.
</task_objective>

<detailed_sequence_of_steps>

1. Add duration policy utilities and unit tests

- Create `src/utils/duration.js` with:
  - `normalizeState(state)` → `done`→`completed`, `failed|error`→`error`, pass through `pending|running|current|completed|rejected`.
  - `taskDisplayDurationMs(task, now = Date.now())` → rules:
    - if missing `startedAt` → `0`
    - `pending` → `0`
    - `running|current` → `max(0, now - Date.parse(startedAt))`
    - `completed|done` → `max(0, Date.parse(endedAt ?? new Date(now).toISOString()) - Date.parse(startedAt))`
    - `rejected` → `0`

  - `jobCumulativeDurationMs(job, now = Date.now())` → sum across all tasks (array or object).

- Keep existing helpers (`fmtDuration`, `elapsedBetween`) but do **not** use them for policy.
- Add tests in `tests/duration-utils.test.js` for all states, edge cases, and both array/object task shapes using `vi.useFakeTimers()` + `vi.setSystemTime()`.

<new_task>
Title: Add duration utilities & unit tests
Prompt:
Create src/utils/duration.js with normalizeState, taskDisplayDurationMs, jobCumulativeDurationMs per the policy above. Add tests in tests/duration-utils.test.js for lifecycle states (pending, running, completed with/without endedAt, rejected), future/missing times, and array/object task collections using vi.useFakeTimers and vi.setSystemTime. Run: `npx vitest run`. Then stage and commit:
`git add -A && git commit -m "feat(utils): add duration policy helpers (normalizeState, taskDisplayDurationMs, jobCumulativeDurationMs)"`.
</new_task>

2. Wire JobDetail subtitle to the new policy (prefer executionTime for completed)

- In `src/components/JobDetail.jsx`:
  - Import `{ normalizeState, taskDisplayDurationMs }` from `src/utils/duration.js`.
  - Compute duration as:
    - if `normalizeState(task.state) === 'completed'` and `executionTime != null` → use `executionTime`
    - else → `taskDisplayDurationMs(task, now)`

  - Render duration only when ms > 0; replace `time:` with inline separator `·`.

- Update/add tests in `tests/JobDetail.detail-shaped.test.jsx`.

<new_task>
Title: Use policy duration in JobDetail subtitle
Prompt:
Update src/components/JobDetail.jsx to use normalizeState and taskDisplayDurationMs as described, with executionTime precedence for completed. Render duration only when > 0 and format with fmtDuration; use " · " separator. Update/add tests in tests/JobDetail.detail-shaped.test.jsx for pending/rejected hidden, running positive, completed executionTime precedence. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(jobdetail): use policy duration in DAG subtitles with executionTime preference"`.
</new_task>

3. Create a reactive ticker hook

- Add `src/ui/client/hooks/useTicker.js`:
  - `useTicker(intervalMs = 1000)` → state of `Date.now()` updated on `setInterval`; cleanup on unmount.

- Tests: `tests/useTicker.test.js` with fake timers verifying ticks and cleanup.

<new_task>
Title: Add useTicker hook for live durations
Prompt:
Create src/ui/client/hooks/useTicker.js exporting useTicker(intervalMs=1000) that updates a `now` state every interval and cleans up. Add tests in tests/useTicker.test.js using vi.useFakeTimers to verify ticks and cleanup. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(hooks): add useTicker for 1s reactive time source"`.
</new_task>

4. Make JobDetail reactive (live ticking)

- In `src/components/JobDetail.jsx`:
  - `const now = useTicker(1000);`
  - Pass `now` into policy computations so running tasks update once/second.

- Extend tests to advance timers and assert UI updates.

<new_task>
Title: Wire JobDetail to useTicker for live updates
Prompt:
Import useTicker in src/components/JobDetail.jsx, compute `now = useTicker(1000)`, and use it when calling taskDisplayDurationMs so running tasks re-render each second. Extend tests/JobDetail.detail-shaped.test.jsx with vi.useFakeTimers and vi.advanceTimersByTime assertions. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(jobdetail): live-update running task durations via useTicker"`.
</new_task>

5. Unify current task duration in JobTable

- In `src/components/JobTable.jsx`:
  - Replace ad-hoc elapsed logic with `taskDisplayDurationMs(currentTask, now)`.
  - Hide duration element for `pending`.
  - Use `useTicker(1000)` to refresh while running.

- Tests: `tests/JobTable.duration.test.jsx`.

<new_task>
Title: Apply duration policy in JobTable
Prompt:
Update src/components/JobTable.jsx to use taskDisplayDurationMs(currentTask, now) with now from useTicker(1000); hide duration for pending; verify running updates and completed fixed in tests/JobTable.duration.test.jsx using fake timers. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(jobtable): unify current task duration with policy and live ticker"`.
</new_task>

6. Unify current task duration in JobCard

- In `src/components/JobCard.jsx`:
  - Mirror JobTable changes using policy + `useTicker(1000)`.

- Tests: `tests/JobCard.duration.test.jsx`.

<new_task>
Title: Apply duration policy in JobCard
Prompt:
Update src/components/JobCard.jsx to use taskDisplayDurationMs and useTicker(1000), hiding duration for pending and updating for running; add tests in tests/JobCard.duration.test.jsx for pending/running/completed with fake timers. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(jobcard): unify current task duration with policy and live ticker"`.
</new_task>

7. Compute cumulative job duration consistently

- Replace parent logic that generates `overallElapsedMs` with `jobCumulativeDurationMs(job, now)` and share `now` from `useTicker(1000)`.

<new_task>
Title: Use jobCumulativeDurationMs for totals
Prompt:
Locate parent component(s) computing overallElapsed/overallElapsedMs; replace with jobCumulativeDurationMs(job, now) using a shared now from useTicker(1000). Add/adjust tests to assert totals equal the sum of per-task display durations. Run: `npx vitest run`. Then:
`git add -A && git commit -m "feat(durations): compute cumulative job duration via policy helper"`.
</new_task>

8. Harmonize microcopy & typography (Tufte-inspired)

- JobDetail/JobTable/JobCard:
  - Inline tokens joined by `·`.
  - Small, muted text for durations; right-align totals; no badges/all caps.

<new_task>
Title: Tufte-style duration presentation
Prompt:
In JobDetail/JobTable/JobCard, harmonize duration microcopy: inline tokens with " · ", remove "time:", small muted typography, consistent alignment (right-aligned for totals), no badges or all caps. Run: `npx vitest run`. Then:
`git add -A && git commit -m "style(ui): harmonize duration microcopy and typography (Tufte-inspired)"`.
</new_task>

9. Add component tests for task shape variants

- Add `tests/JobDetail.array-tasks.test.jsx` validating array-shaped tasks for pending/rejected hidden, running live, completed fixed; parallelize for object-shaped if applicable.

<new_task>
Title: Add component tests for task shape variants
Prompt:
Create tests/JobDetail.array-tasks.test.jsx to validate policy for array-shaped tasks (pending/rejected hidden, running ticks, completed fixed). If object-shaped tasks are used, include parallel cases. Use vi.useFakeTimers consistently. Run: `npx vitest run`. Then:
`git add -A && git commit -m "test(jobdetail): add coverage for array/object task shapes and timer-driven updates"`.
</new_task>

10. Remove ad-hoc UI duration logic and migrate all callers

- Replace remaining `elapsedBetween` usages for **displayed** durations with policy helpers and centralize imports.

<new_task>
Title: Remove legacy ad-hoc duration code
Prompt:
Replace all remaining UI usages of elapsedBetween for displayed durations with policy helpers from src/utils/duration.js; ensure no UI code computes durations outside the helpers. Run: `npx vitest run`. Then:
`git add -A && git commit -m "refactor(durations): remove ad-hoc UI duration logic in favor of policy helpers"`.
</new_task>

11. Documentation update

- Add doc section (`docs/architecture.md` or `docs/durations.md`) covering:
  - State normalization, helper semantics, executionTime precedence, UI conventions, test strategy.

<new_task>
Title: Document duration policy and usage
Prompt:
Add documentation (docs/architecture.md section or docs/durations.md) describing the duration policy, helper functions, executionTime precedence, UI conventions, and deterministic testing with fake timers. Then:
`git add -A && git commit -m "docs(durations): document policy, helpers, and UI conventions"`.
</new_task>

12. Final verification & green build

- Run the full suite; ensure acceptance criteria:
  - Pending hidden; Running increments once/second; Completed fixed (or `executionTime`); Rejected hidden; Cumulative equals sum by rule; Table/Card/Detail consistent.

<new_task>
Title: Verify acceptance criteria and tests
Prompt:
Run: `npx vitest run`. If all assertions pass and acceptance criteria are met, create a final bookkeeping commit to record the green build:
`git add -A && git commit -m "test: verify acceptance criteria for duration policy (all green)"`.
</new_task>

</detailed_sequence_of_steps>
