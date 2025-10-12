# Pipeline View Replacement Plan (Final)

**File:** `plan-pipeline-view.md`  
**Updated:** October 12, 2025

This plan replaces the JobDetail “Timeline” with a DAG grid backed by real task data. It is definitive, incremental, and test-driven. Each step is mergeable and keeps risk low.

---

## Overview

- Introduce a pure mapping layer (`computeDagItems`, `computeActiveIndex`) that converts `job` + `pipeline` into presentable DAG items.
- Add a focused `DAGGrid` component (grid + connectors + slide-over) with a minimal smoke + interaction test.
- Wire `DAGGrid` into `JobDetail`, preserving Outputs/Resume. Accessibility and deterministic behavior are required.
- Subtitle polish (e.g., model/temp/attempts) may be deferred to a follow-up PR if it slows delivery.

---

## Acceptance Checklist (Definitive)

- [ ] **Real data:** JobDetail renders `DAGGrid` using real job/pipeline data (no placeholders).
- [ ] **Deterministic statuses:** Explicit mapping: `done→succeeded`, `running→active`, `error→error`, `pending|queued|created→pending`, `skipped|canceled→succeeded` (or set to `pending` if you want to visualize blockage; choose one and encode in tests).
- [ ] **Deterministic active step:**
  1. if any `active` → highlight **first active**;
  2. else if any `error` → highlight **first error**;
  3. else if any `succeeded` → highlight **last succeeded**;
  4. else → highlight index `0`.
- [ ] **Deterministic ordering when data disagree:**
  - Start with `pipeline.tasks` (canonical order).
  - Append any tasks present in `job` but **not** in `pipeline.tasks` **in job order**.
  - Do not drop tasks silently. Each item may carry `source: 'pipeline' | 'job-extra'` (debug-only) for tests and diagnostics.
- [ ] **Titles & subtitles:** Title uses real task id/name; subtitle shows minimal useful metadata (model/temp/attempts/time) when available, otherwise omitted gracefully.
- [ ] **Accessibility:** `role="list"` container; cards `role="listitem"`; active card has `aria-current="step"`; slide-over focuses close button on open; Escape closes; focus trapped while open.
- [ ] **Safety on missing data:** If `job` or `job.tasks` is null/empty, render an empty grid without errors.
- [ ] **Timeline replaced:** Old “Timeline” list is replaced by `DAGGrid`; Outputs/Artifacts and “Resume from” continue to work.
- [ ] **Tests:** Unit tests cover mapping/ordering/active selection/unknown states; component tests include smoke + slide-over toggle + `aria-current` assertion.
- [ ] **No JSDOM layout errors:** `ResizeObserver` and `getBoundingClientRect` mocked; no open handles.
- [ ] **Docs artifact excluded:** `docs/designs/single-pipeline-view.jsx` is not imported/built/tested.

---

## Deterministic Behavior

### Status Mapping

- `done → succeeded`
- `running → active`
- `error → error`
- `pending | queued | created → pending`
- `skipped | canceled →` **choose** `succeeded` (treated as non-blocking) **or** `pending` (if you prefer surfacing blockage). Encode chosen path in tests.
- Unknown states → `pending` (default).

### Active Step Rule

1. First `active`; 2) first `error`; 3) last `succeeded`; 4) else index `0`.

### Ordering When Data Disagree

1. `pipeline.tasks` (canonical); 2) append `job`-only tasks in job’s order; 3) never drop tasks silently; 4) add debug `source` flag for tests.

---

## File Change List (path → purpose)

- `docs/designs/single-pipeline-view.jsx` → **Reference only** (ensure test/build ignore).
- `src/utils/dag.js` (**new**) → `computeDagItems(job, pipeline)`, `computeActiveIndex(items)`; pure + unit-testable.
- `src/components/DAGGrid.jsx` (**new**) → Grid + SVG connectors; props: `items`, `cols=3`, `cardClass`, `activeIndex`; slide-over skeleton intact.
- `src/components/JobDetail.jsx` → Replace Timeline with `DAGGrid`; wire items via mapping; keep Outputs/Resume intact.
- `src/ui/client/adapters/job-adapter.js` → **No change** (used for reference of states).
- `tests/dag-mapping.test.js` (**new**) → Unit tests for mapping, ordering, active index, unknown states, empty data.
- `tests/DAGGrid.smoke.test.jsx` (**new**) → Component smoke + minimal interaction/accessibility tests; mock layout APIs.

> **Build/Test guard:** Ensure `/docs/**` is excluded or not referenced from `src/**` so Vite/Jest doesn’t attempt to compile docs assets.

---

## Steps

Step 1. **Mapping first (no UI change)**

- Add `src/utils/dag.js` with `computeDagItems`, `computeActiveIndex` implementing the deterministic rules above.
- Add `tests/dag-mapping.test.js`: - Status mapping: includes unknown state fallback. - Ordering: pipeline-first, then job-only, preserving job order. - Active index selection: follows the 4-step rule. - Empty/null job produces `[]` items; `computeActiveIndex` returns `0` (per rule step 4).
  Step 2. **Component + smoke/interaction**
- Add `src/components/DAGGrid.jsx` with grid + connectors, slide-over shell, `aria-current="step"` on active card.
- Add `tests/DAGGrid.smoke.test.jsx`: - Mocks `ResizeObserver`/`getBoundingClientRect`. - Renders N cards for N items; titles present; exactly one `aria-current="step"` when `activeIndex` provided. - Click first card opens slide-over; clicking close “X” (or pressing Escape) closes it.
  Step 3. **Wire into JobDetail**
- Import mapping + `DAGGrid`; replace Timeline; compute `items` + `activeIndex` from real data.
- Verify Outputs/Resume unaffected.
- Optional: wrap behind a temporary flag for quick rollback during review.

Step 4. **(Optional) Subtitle polish**

- Enrich subtitles with model/temp/attempts/time when available; ensure graceful absence handling.
- Keep visual polish (chips, classNames) scoped and non-breaking.

---

## Test Plan (names → assertions)

### `tests/dag-mapping.test.js`

- **maps states**: done/running/error/pending/queued/created/(unknown) → expected targets; explicit test for `unknown → pending`.
- **orders items**: pipeline order first; appends job-only tasks in job order; include `source` flag coverage.
- **activeIndex deterministic**: first active; else first error; else last succeeded; else `0`.
- **empty/missing data**: returns `[]`; `computeActiveIndex` yields `0`.
- **mismatched IDs**: when pipeline lists tasks missing in job, items still present with `pending` (or skipped) status—documented in the test description.

### `tests/DAGGrid.smoke.test.jsx`

- **renders without layout errors** with mocks in place.
- **card count & titles**: N cards for N items; titles visible.
- **active ARIA**: exactly one card has `aria-current="step"` when `activeIndex` is provided.
- **slide-over interaction**: click card opens; “X” closes; Escape closes.

> AfterEach: restore mocks, timers, and DOM state to avoid open handles.

---

## Risks & Mitigations

- **JSDOM Layout APIs**: Mock `ResizeObserver` and `getBoundingClientRect` → keep tests minimal on layout specifics.
- **Null/late pipeline**: If `pipeline` is null, use union strategy (job order + append), with clear tests.
- **SSE staleness**: JobDetail uses snapshot; acceptable for this change. Future enhancement: fetch `/api/jobs/:id` on open or subscribe to list updates.
- **Docs leakage into build**: Keep design files out of `src/**` and test roots.

---

## SSE/Endpoints (Reference Only)

- List: hydrated via `useJobListWithUpdates` (SSE).
- Detail: currently a snapshot; not changed by this plan. Future optional: poll `/api/jobs/:id` or accept SSE detail updates.

---

## Definition of Done

- DAG grid renders from real data with deterministic ordering, status mapping, and active selection.
- Timeline replaced; Outputs/Resume unaffected.
- Safe empty-state behavior.
- Mapping and component tests pass (including interaction/ARIA assertions). No open handles or layout errors.
- Docs asset excluded from build/tests.
- CI green and no regressions in existing suites.

---

## Commands

```bash
# run tests
npm -s test

# focused runs
npm -s test -- dag-mapping
npm -s test -- DAGGrid.smoke
```

---

## Conventional Commit

**Subject:** `feat(ui): replace JobDetail timeline with DAG grid and real task mapping`

**Body:**

- Introduce `DAGGrid` to visualize pipeline steps with connectors and responsive layout.
- Replace JobDetail “Timeline” with `DAGGrid` backed by real job data.
- Add pure mapping utilities (`computeDagItems`, `computeActiveIndex`) with unit tests.
- Add component smoke/interaction tests with mocked layout APIs.

**Files:**

- `src/components/DAGGrid.jsx` — new DAG component (grid + connectors; slide-over shell).
- `src/utils/dag.js` — pure mapping helpers.
- `src/components/JobDetail.jsx` — integration of DAGGrid and mapping.
- `tests/dag-mapping.test.js` — unit tests for mapping and edge cases.
- `tests/DAGGrid.smoke.test.jsx` — smoke + interaction tests with accessibility checks.
