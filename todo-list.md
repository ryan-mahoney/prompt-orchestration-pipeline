# Unified Duration System Implementation

## Phase 1: Core Infrastructure

- [ ] Add duration policy utilities and unit tests (src/utils/duration.js, tests/duration-utils.test.js)
- [ ] Wire JobDetail subtitle to the new policy (prefer executionTime for completed)
- [ ] Create a reactive ticker hook (src/ui/client/hooks/useTicker.js, tests/useTicker.test.js)
- [ ] Make JobDetail reactive (live ticking)

## Phase 2: Consumer Components

- [ ] Unify current task duration in JobTable
- [ ] Unify current task duration in JobCard
- [ ] Compute cumulative job duration consistently

## Phase 3: UI Polish & Testing

- [ ] Harmonize microcopy & typography (Tufte-inspired)
- [ ] Add component tests for task shape variants
- [ ] Remove ad-hoc UI duration logic and migrate all callers

## Phase 4: Documentation & Verification

- [ ] Documentation update
- [ ] Final verification & green build

## Acceptance Criteria

- Pending tasks show no duration
- Running tasks increment once per second
- Completed tasks show fixed duration (or executionTime if available)
- Rejected tasks show no duration
- Cumulative duration equals sum of task display durations
- JobTable, JobCard, and JobDetail all consistent
- All tests pass with fake timers
