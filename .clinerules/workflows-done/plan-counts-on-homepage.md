# Dashboard Tab Counts - Multi-Phase Implementation

<task_objective>
Implement dynamic counts on dashboard tabs across 3 phases, each in its own context.
Each phase completes fully before transitioning. No user interaction required.
</task_objective>

<detailed_sequence_of_steps>

## Phase 1: Core Tab Counts Implementation

### Context

Implementing tab count display for Current, Errors, and Completed tabs in PromptPipelineDashboard.

### Requirements

- File: `src/pages/PromptPipelineDashboard.jsx`
- Tab labels must show counts: "Current (X)", "Errors (Y)", "Completed (Z)"
- Counts are already computed via useMemo: currentCount, errorCount, completedCount
- Use inline text for accessibility (not badges)
- Tabs are Radix UI with values: current, errors, complete

### Implementation Steps

1. **Modify tab triggers to include counts**
   - Open `src/pages/PromptPipelineDashboard.jsx`
   - Locate the Tabs.Trigger components
   - Change from `<Tabs.Trigger value="current">Current</Tabs.Trigger>`
   - To: `<Tabs.Trigger value="current">Current ({currentCount})</Tabs.Trigger>`
   - Apply same pattern for "errors" → errorCount and "complete" → completedCount

2. **Add test: "renders tab counts from initial data"**
   - Open `tests/PromptPipelineDashboard.test.jsx`
   - Mock jobs with mixed statuses (e.g., 2 running, 1 error, 1 complete)
   - Assert tab buttons exist with names: "Current (2)", "Errors (1)", "Completed (1)"
   - Use: `screen.getByRole('tab', { name: /Current \(2\)/i })`

3. **Add test: "filters rows when switching tabs"**
   - Provide mixed dataset
   - Assert default "Current" tab shows only running rows
   - Click "Errors" tab, assert only error rows visible
   - Click "Completed" tab, assert only completed rows visible

4. **Run tests**
   - Execute: `npm -s test -- PromptPipelineDashboard`
   - If failures occur, debug and fix automatically
   - Retry up to 3 times

5. **Verify implementation**
   - All tests pass
   - Tab counts display correctly
   - Filtering works as expected

6. **Commit changes**
   - Git add modified files
   - Commit with message: "feat(ui): display dynamic counts on dashboard tabs and filter by tab"

### Transition to Phase 2

<new_task>
<context>

# Phase 2: Robustness Tests & Edge Cases

## Completed Work

✅ Phase 1: Core tab counts implementation

- Modified: src/pages/PromptPipelineDashboard.jsx
- Modified: tests/PromptPipelineDashboard.test.jsx
- Tab labels now show: "Current (X)", "Errors (Y)", "Completed (Z)"
- Basic filtering tests added
- All tests passing
- Committed: "feat(ui): display dynamic counts on dashboard tabs and filter by tab"

## Current Phase Objective

Add comprehensive edge case tests:

1. Zero counts when API error occurs
2. Active tab stability (no auto-switching)
3. Screen reader accessibility verification

## Technical Context

- Tabs use Radix UI Tabs component
- Counts computed via useMemo: currentCount, errorCount, completedCount
- Error state shows banner, upload stays enabled
- Tests use @testing-library/react

## Implementation Requirements

1. Test: "shows zero counts with API error"
   - Mock useJobListWithUpdates to return error state
   - Assert all tabs show "(0)"
   - Assert error banner displays
   - Assert upload button remains enabled

2. Test: "keeps active tab selected on updates"
   - Click "Errors" tab
   - Simulate data update (if feasible in test)
   - Assert "Errors" tab remains active (no auto-switch)

## Files to Modify

- tests/PromptPipelineDashboard.test.jsx (add 2 new tests)

## Success Criteria

- All edge case tests pass
- No regression in existing tests
- Ready for Phase 3 (optional enhancement)
  </context>
  </new_task>

---

## Phase 2: Robustness Tests & Edge Cases

(Runs in new context from transition above)

### Implementation Steps

1. **Add test: "shows zero counts with API error"**
   - Open `tests/PromptPipelineDashboard.test.jsx`
   - Mock useJobListWithUpdates to return: `{ jobs: [], isLoading: false, error: 'API Error' }`
   - Render component
   - Assert: `screen.getByRole('tab', { name: /Current \(0\)/i })`
   - Assert: `screen.getByRole('tab', { name: /Errors \(0\)/i })`
   - Assert: `screen.getByRole('tab', { name: /Completed \(0\)/i })`
   - Assert error banner visible
   - Assert upload button not disabled

2. **Add test: "keeps active tab selected on user interaction"**
   - Render with mixed job data
   - Click "Errors" tab: `fireEvent.click(screen.getByRole('tab', { name: /Errors/ }))`
   - Assert "Errors" tab has aria-selected="true"
   - Assert only error rows visible in table
   - Click "Completed" tab
   - Assert "Completed" tab has aria-selected="true"
   - Assert only completed rows visible

3. **Run all tests**
   - Execute: `npm -s test -- PromptPipelineDashboard`
   - Debug and fix any failures automatically
   - Maximum 3 retry attempts

4. **Verify robustness**
   - All edge cases covered
   - No accessibility regressions
   - Error states handled gracefully

5. **Commit changes**
   - Git add modified test file
   - Commit with message: "test(ui): cover tab count zero-states and stable active tab behavior"

### Transition to Phase 3

<new_task>
<context>

# Phase 3: Optional Enhancement - Broaden "Current" Definition

## Completed Work

✅ Phase 1: Core implementation (tab counts + filtering)
✅ Phase 2: Robustness tests (edge cases, error states, accessibility)

- All tests passing
- Commits:
  - "feat(ui): display dynamic counts on dashboard tabs and filter by tab"
  - "test(ui): cover tab count zero-states and stable active tab behavior"

## Current Phase Objective

OPTIONAL: Expand "current" tab to include all in-progress states, not just "running"

## Decision Point

Current implementation: "Current" tab = jobs where status === "running"

Enhancement option: "Current" tab = jobs where status NOT IN ["error", "complete"]

- This would include: "pending", "queued", "running", any future in-progress states
- More intuitive: "Current" = "work in progress" vs "Completed" = "done" vs "Errors" = "failed"

## Implementation if Proceeding

### Files to Modify

1. src/pages/PromptPipelineDashboard.jsx
   - Update currentCount useMemo selector
   - Update filteredJobs logic for activeTab === 'current'

2. tests/PromptPipelineDashboard.test.jsx
   - Update test fixtures to include jobs with status "pending"
   - Update assertions for "Current" count to include pending jobs
   - Verify filtering includes pending jobs in Current tab

### Exact Changes Needed

In PromptPipelineDashboard.jsx:

Current selector:

```javascript
const currentCount = useMemo(
  () => jobs.filter((job) => job.status === "running").length,
  [jobs]
);
```

Change to:

```javascript
const currentCount = useMemo(
  () =>
    jobs.filter((job) => !["error", "complete"].includes(job.status)).length,
  [jobs]
);
```

And in filteredJobs:

```javascript
case 'current':
  return jobs.filter(job => !['error', 'complete'].includes(job.status));
```

## Success Criteria

- "Current" tab includes all non-terminal states
- Tests verify pending jobs appear in Current tab
- All existing tests still pass
- Commit: "refactor(ui): define current tab as in-progress (pending+running)"

## Autonomous Decision

Check the codebase for any "pending" or "queued" status values in job data.
If none exist in the data model, SKIP this phase (not needed yet).
If they exist, IMPLEMENT this enhancement.
</context>
</new_task>

---

## Phase 3: Optional Enhancement - Broaden "Current" Definition

(Runs in new context from transition above)

### Implementation Steps

1. **Search for job status values in codebase**
   - Look for "pending" or "queued" status values in src/ directory
   - Check for patterns like: `status = "pending"`, `case "queued"`, etc.

2. **Decision: Implement or Skip**
   - IF search finds "pending" or "queued" statuses: PROCEED with implementation
   - IF search finds ONLY "running", "error", "complete": SKIP (log decision and end phase)

3. **If implementing: Update currentCount selector**
   - Open `src/pages/PromptPipelineDashboard.jsx`
   - Change from: `jobs.filter(job => job.status === 'running')`
   - To: `jobs.filter(job => !['error', 'complete'].includes(job.status))`

4. **Update filteredJobs logic**
   - In the switch case for 'current':
   - Change to: `return jobs.filter(job => !['error', 'complete'].includes(job.status));`

5. **Update tests**
   - Open `tests/PromptPipelineDashboard.test.jsx`

6. **Add test fixtures with pending jobs**
   - Add jobs with status: "pending" to test data
   - Update count assertions to include pending in Current count
   - Verify pending jobs appear when Current tab is active

7. **Run all tests**
   - Execute: `npm -s test -- PromptPipelineDashboard`
   - Fix any failures automatically
   - Maximum 3 retry attempts

8. **Commit if implemented**
   - Git add modified files
   - Commit: "refactor(ui): define current tab as in-progress (pending+running)"
   - OR if skipped: Create note that enhancement not needed yet

9. **Final verification**
   - Run full test suite: `npm -s test`
   - All phases complete
   - All tests passing
   - Feature fully implemented

### Completion Summary

Log summary of all work completed:

- Phase 1: Tab counts and filtering ✅
- Phase 2: Robustness and edge case tests ✅
- Phase 3: Current tab enhancement [IMPLEMENTED/SKIPPED] ✅

Total commits: 2-3
All tests passing: YES/NO
Feature complete: YES

</detailed_sequence_of_steps>

## Execution Instructions

**Autonomous Behavior:**

- Do NOT ask user any questions via ask_followup_question
- Make implementation decisions based on code inspection
- Auto-fix test failures (up to 3 attempts)
- Use new_task between phases for fresh context
- Commit after each phase completion

**Quality Checks:**

- All tests must pass before phase transition
- Verify changes don't break existing functionality
- Use meaningful commit messages
- Log all decisions made

**Error Handling:**

- If tests fail 3 times, log detailed error and proceed to commit partial work
- If critical blocker found, log issue and stop (don't proceed to next phase)
- Always attempt to leave codebase in working state
