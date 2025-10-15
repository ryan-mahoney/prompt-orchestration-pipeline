# JobDetail Error Alert - Multi-Phase Workflow

<task_objective>
Show task error.message from job.tasks in the JobDetail slide-over using a Radix UI Callout with accessible role="alert", including unit and integration tests. Each phase runs in its own context. No user interaction required.
</task_objective>

<detailed_sequence_of_steps>

## Phase 1: Create Feature Branch

### Implementation Steps

1. **Create feature branch**
   - Execute: `git checkout -b rpm-jobdetail-error-alert`
   - Verify branch created successfully

### Transition to Phase 2

Use the new_task tool with this context:

<context>
# Phase 2: Add Unit Test for Error Body

## Completed Work

✅ Phase 1: Created feature branch rpm-jobdetail-error-alert

## Background Context

- Error shape: tasks.analysis.state = "failed", tasks.analysis.error.message contains user-facing string
- JobDetail.jsx builds DAG items via computeDagItems, enriches with title/subtitle
- Need to populate item.body with error message for failed tasks
- Demo data location: demo/pipeline-data/current/6seZRu98s38b/tasks-status.json

## Current Phase Objective

Add unit test to assert DAG items include error message as body for failed tasks

## Implementation Steps

1. **Open test file**
   - File: tests/JobDetail.detail-shaped.test.jsx

2. **Add new test: "passes error message as item.body for failed task"**
   - Arrange:
     - Configure computeDagItemsSpy.mockReturnValue with item list containing analysis with status "error"
     - Create job with tasks including:
       ```javascript
       {
         name: "analysis",
         state: "failed",
         error: {
           message: "analysis failed after 2 attempts: Validation failed after all refinement attempts"
         }
       }
       ```
     - Pipeline includes ["analysis"]
   - Act:
     - Render JobDetail with above job and pipeline
   - Assert:
     - Read mocked DAGGrid items JSON via data-testid="dag-items"
     - Parse JSON and find item with id "analysis"
     - Expect item.body equals the error message string provided

3. **Run tests**
   - Execute: `npm -s test -- JobDetail.detail-shaped`
   - Fix any failures automatically (max 3 attempts)

4. **Commit changes**
   - Git add: tests/JobDetail.detail-shaped.test.jsx
   - Commit message: "test(ui): JobDetail passes task error message to DAG items as body when status=error"

## Next Phase

After completing and committing, transition to Phase 3 to implement the error body population in JobDetail.jsx
</context>

---

## Phase 2: Add Unit Test for Error Body

(Runs in new context from transition above)

### Transition to Phase 3

Use the new_task tool with this context:

<context>
# Phase 3: Implement Error Body Population

## Completed Work

✅ Phase 1: Created feature branch rpm-jobdetail-error-alert
✅ Phase 2: Added unit test for error body in DAG items

- Modified: tests/JobDetail.detail-shaped.test.jsx
- Test added: "passes error message as item.body for failed task"
- Commit: "test(ui): JobDetail passes task error message to DAG items as body when status=error"

## Current Phase Objective

Implement error body population in JobDetail.jsx so DAG items include task error messages

## Implementation Steps

1. **Open implementation file**
   - File: src/components/JobDetail.jsx

2. **Modify DAG item mapping to include error body**
   - Locate the section where computeDagItems(...).map(item => { ... })
   - Derive error message from task:
     ```javascript
     const task = taskById[item.id];
     const errorMsg = task?.error?.message;
     const body = item.status === "error" && errorMsg ? errorMsg : null;
     ```
   - Include `body` in the returned item object
   - This ensures items array passed to DAGGrid contains error message for error tasks

3. **Run tests to verify implementation**
   - Execute: `npm -s test -- JobDetail.detail-shaped`
   - Should now pass the test added in Phase 2
   - Fix any failures automatically (max 3 attempts)

4. **Commit implementation**
   - Git add: src/components/JobDetail.jsx
   - Commit message: "feat(ui): include task error.message in DAG items body for error tasks"

## Next Phase

After completing and committing, transition to Phase 4 to render the error Callout in the slide-over
</context>

---

## Phase 3: Implement Error Body Population

(Runs in new context from transition above)

### Transition to Phase 4

Use the new_task tool with this context:

<context>
# Phase 4: Render Error Callout in Slide-Over

## Completed Work

✅ Phase 1: Created feature branch
✅ Phase 2: Added unit test for error body
✅ Phase 3: Implemented error body population in JobDetail.jsx

- Modified: src/components/JobDetail.jsx
- Now populates item.body with task.error.message for error status tasks
- Commit: "feat(ui): include task error.message in DAG items body for error tasks"

## Background Context

- DAGGrid.jsx contains the slide-over panel implementation
- Slide-over currently shows "Input", "Output", and optional file content
- Need to add error section at top when selected task has error
- Use Radix UI Callout component (already in dependencies: @radix-ui/themes)

## Current Phase Objective

Render error Callout in DAGGrid slide-over when selected item has error status and body

## Implementation Steps

1. **Modify DAGGrid.jsx to show error Callout**
   - File: src/components/DAGGrid.jsx
   - Import Callout:
     ```javascript
     import { Callout } from "@radix-ui/themes";
     ```
   - In slide-over content (inside `<div className="p-6 space-y-8 ...">`):
   - Add error section at the top when `items[openIdx]?.status === "error" && items[openIdx]?.body`:
     ```javascript
     <section aria-label="Error">
       <Callout.Root color="red" role="alert" aria-live="assertive">
         <Callout.Text className="whitespace-pre-wrap break-words">
           {items[openIdx].body}
         </Callout.Text>
       </Callout.Root>
     </section>
     ```
   - Ensure styles maintain visual hierarchy and content wraps properly

2. **Create integration test for error alert**
   - New file: tests/JobDetail.error-alert.test.jsx
   - Test: "shows error Callout in slide-over when selected task has error"
   - Arrange:
     - Render JobDetail with job/pipeline where analysis is "failed" with error.message
     - Do NOT mock DAGGrid (use real component for integration test)
   - Act:
     - Click the analysis card (role="listitem") to open slide-over
   - Assert:
     - Expect element with role="alert" to be visible
     - Expect it to contain the error message text

3. **Run tests**
   - Execute: `npm -s test -- JobDetail.error-alert`
   - Fix any failures automatically (max 3 attempts)

4. **Commit changes**
   - Git add: src/components/DAGGrid.jsx tests/JobDetail.error-alert.test.jsx
   - Commit message: "feat(ui): show error Callout in JobDetail slide-over when task status=error"

## Next Phase

After completing and committing, transition to Phase 5 for edge cases and safety tests
</context>

---

## Phase 4: Render Error Callout in Slide-Over

(Runs in new context from transition above)

### Transition to Phase 5

Use the new_task tool with this context:

<context>
# Phase 5: Edge Cases and Safety Tests

## Completed Work

✅ Phase 1: Created feature branch
✅ Phase 2: Added unit test for error body
✅ Phase 3: Implemented error body population
✅ Phase 4: Rendered error Callout in slide-over

- Modified: src/components/DAGGrid.jsx, tests/JobDetail.error-alert.test.jsx
- Error Callout now shows in slide-over with role="alert"
- Commit: "feat(ui): show error Callout in JobDetail slide-over when task status=error"

## Current Phase Objective

Add edge case tests and ensure safe rendering (no XSS, handles missing error gracefully)

## Implementation Steps

1. **Verify safe text rendering**
   - File: src/components/DAGGrid.jsx
   - Confirm error message is treated as plain text
   - Should NOT use dangerouslySetInnerHTML
   - Current implementation with Callout.Text is safe

2. **Add edge case test: "does not render alert when no error message"**
   - File: tests/JobDetail.error-alert.test.jsx
   - Arrange:
     - Analysis status is "failed" but error is undefined OR error lacks message property
   - Act:
     - Open slide-over for the failed task
   - Assert:
     - Element with role="alert" should NOT be present
     - Slide-over should still render without errors

3. **Add edge case test: "handles long error messages with wrapping"**
   - Same test file
   - Arrange:
     - Very long error message (200+ characters)
   - Act:
     - Open slide-over
   - Assert:
     - role="alert" is present
     - Text wraps properly (whitespace-pre-wrap and break-words classes working)

4. **Run all tests**
   - Execute: `npm -s test -- JobDetail.error-alert`
   - Also run: `npm -s test -- JobDetail.detail-shaped` to ensure no regression
   - Fix any failures automatically (max 3 attempts)

5. **Commit edge case tests**
   - Git add: tests/JobDetail.error-alert.test.jsx (and DAGGrid.jsx if any fixes needed)
   - Commit message: "test(ui): ensure slide-over alert renders only when error message exists"

## Next Phase

After completing and committing, transition to Phase 6 to push the branch
</context>

---

## Phase 5: Edge Cases and Safety Tests

(Runs in new context from transition above)

### Transition to Phase 6

Use the new_task tool with this context:

<context>
# Phase 6: Push Branch

## Completed Work

✅ Phase 1: Created feature branch
✅ Phase 2: Added unit test for error body
✅ Phase 3: Implemented error body population
✅ Phase 4: Rendered error Callout in slide-over
✅ Phase 5: Added edge case and safety tests

- All tests passing
- Feature complete and safe
- Total commits: 4

## Summary of Changes

- Modified files:
  - src/components/JobDetail.jsx (error body population)
  - src/components/DAGGrid.jsx (error Callout rendering)
  - tests/JobDetail.detail-shaped.test.jsx (unit test)
  - tests/JobDetail.error-alert.test.jsx (integration and edge case tests)

## Current Phase Objective

Push the feature branch to remote repository

## Implementation Steps

1. **Verify all tests pass**
   - Execute: `npm -s test`
   - Ensure no failures before pushing

2. **Push branch to remote**
   - Execute: `git push --set-upstream origin rpm-jobdetail-error-alert`
   - Verify push succeeds

3. **Verify branch is on remote**
   - Check git output confirms branch was set up to track remote

## Next Phase

After pushing, transition to Phase 7 to open the Pull Request
</context>

---

## Phase 6: Push Branch

(Runs in new context from transition above)

### Transition to Phase 7

Use the new_task tool with this context:

<context>
# Phase 7: Open Pull Request

## Completed Work

✅ Phase 1-5: Feature implementation complete with tests
✅ Phase 6: Branch pushed to origin

- Branch: rpm-jobdetail-error-alert
- All tests passing
- Ready for PR

## Current Phase Objective

Create Pull Request using GitHub CLI or UI following the project's PR template

## PR Details

**Title:** feat(ui): display analysis task error in JobDetail sidebar

**Description:**

```
## Why
Make task failure reasons immediately visible in the JobDetail panel with an accessible, well-formatted error alert.

## What Changed
- Populate `item.body` with `task.error.message` in JobDetail.jsx when task status is "error"
- Render Radix UI Callout component in DAGGrid slide-over when selected item has error
- Added role="alert" and aria-live="assertive" for screen reader accessibility
- Error text uses whitespace-pre-wrap and break-words for proper formatting

## Files Modified
- src/components/JobDetail.jsx - error body population logic
- src/components/DAGGrid.jsx - error Callout rendering in slide-over
- tests/JobDetail.detail-shaped.test.jsx - unit test for error body
- tests/JobDetail.error-alert.test.jsx - integration and edge case tests

## How Was This Tested
- Unit test: verifies error message passed to DAG items as body
- Integration test: verifies Callout renders in slide-over with role="alert"
- Edge case tests: no error message, long messages with wrapping
- All tests passing locally

## Risks & Rollback
- UI-only change, no API or data model modifications
- Rollback: remove Callout rendering block in DAGGrid.jsx
- No breaking changes to existing functionality

## Checklist
- [x] Tests added/updated
- [x] Inline documentation in code
- [x] All tests passing
- [ ] CI checks passing (will verify after PR creation)
```

## Implementation Steps

1. **Check for gh CLI availability**
   - Try: `gh --version`
   - If available, use gh CLI
   - If not available, provide instructions for manual PR creation

2. **Create PR using gh CLI (if available)**
   - Execute:

     ```bash
     gh pr create --title "feat(ui): display analysis task error in JobDetail sidebar" \
                  --body-file <(cat <<'EOF'
     ## Why
     Make task failure reasons immediately visible in the JobDetail panel with an accessible, well-formatted error alert.

     ## What Changed
     - Populate `item.body` with `task.error.message` in JobDetail.jsx when task status is "error"
     - Render Radix UI Callout component in DAGGrid slide-over when selected item has error
     - Added role="alert" and aria-live="assertive" for screen reader accessibility
     - Error text uses whitespace-pre-wrap and break-words for proper formatting

     ## Files Modified
     - src/components/JobDetail.jsx - error body population logic
     - src/components/DAGGrid.jsx - error Callout rendering in slide-over
     - tests/JobDetail.detail-shaped.test.jsx - unit test for error body
     - tests/JobDetail.error-alert.test.jsx - integration and edge case tests

     ## How Was This Tested
     - Unit test: verifies error message passed to DAG items as body
     - Integration test: verifies Callout renders in slide-over with role="alert"
     - Edge case tests: no error message, long messages with wrapping
     - All tests passing locally

     ## Risks & Rollback
     - UI-only change, no API or data model modifications
     - Rollback: remove Callout rendering block in DAGGrid.jsx
     - No breaking changes to existing functionality

     ## Checklist
     - [x] Tests added/updated
     - [x] Inline documentation in code
     - [x] All tests passing
     - [ ] CI checks passing (will verify after PR creation)
     EOF
     ) \
                  --base main \
                  --head rpm-jobdetail-error-alert
     ```

3. **Verify PR created**
   - Check output for PR URL
   - Log the PR number and URL

4. **Log completion summary**
   - Summary of all 7 phases completed
   - PR link
   - Reminder to monitor CI checks

## Completion

All phases complete! Feature is implemented, tested, and ready for review.
</context>

---

## Phase 7: Open Pull Request

(Runs in new context from transition above)

</detailed_sequence_of_steps>

## Execution Instructions

**Autonomous Behavior:**

- Do NOT ask user questions via ask_followup_question
- Make implementation decisions based on code inspection
- Auto-fix test failures (up to 3 attempts per phase)
- Use new_task between phases for fresh context
- Commit after completing each phase

**Quality Checks:**

- All tests must pass before transitioning to next phase
- Verify no regressions in existing functionality
- Use meaningful, conventional commit messages
- Log all decisions made autonomously

**Error Handling:**

- If tests fail 3 times, log detailed error and commit partial work
- If critical blocker found, log issue and stop (don't proceed to next phase)
- Always leave codebase in working state before transitioning
