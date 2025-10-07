# Test Fix Plan - Iteration 4

Goal

- Fix failing tests related to the status transformer and job endpoints.
- Make focused, test-driven changes so the suite becomes green.

Summary

- Several tests in `tests/status-transformer.test.js` and endpoint tests failed because the `status-transformer` module lacks several named exports and behaviors that tests expect (computeJobStatus, transformTasks, transformMultipleJobs, getTransformationStats), and `job-endpoints` expects transformMultipleJobs to exist. Additionally, some instrumentation log messages are asserted by tests.

Planned Changes (high level)

1. Extend `src/ui/transformers/status-transformer.js` to implement and export:
   - computeJobStatus(tasks) -> { status, progress }
   - transformTasks(rawTasks) -> array of normalized task objects
   - transformMultipleJobs(jobReadResults) -> array of normalized job objects (filtering failed reads)
   - getTransformationStats(readResults, transformedJobs) -> stats object
   - Ensure existing helpers (computeProgress, determineJobStatus) are preserved or used.
   - Match logging/warning message substrings used by tests (console.log / console.warn).
   - Ensure transformJobStatus returns null for invalid input, and returns the expected job shape when valid (id, name, status, progress, createdAt, updatedAt, location, tasks, warnings).

2. Update `src/ui/endpoints/job-endpoints.js` behaviors required by tests:
   - Log "[JobEndpoints] GET /api/jobs called" (console.log) when handleJobList runs.
   - Log "[JobEndpoints] Invalid job ID format" (console.warn) when handleJobDetail receives invalid jobId.

3. Increase test timeout to 10000ms to avoid spurious timing failures.

4. Add documentation of the plan to `docs/test-fix-4.md` (this file).

Implementation Plan (detailed)

- Implement transformTasks and computeJobStatus first.
- Refactor transformJobStatus to call transformTasks and computeJobStatus.
- Implement transformMultipleJobs which logs "Transforming N jobs".
- Implement getTransformationStats to compute counts and status distribution.
- Add small, targeted console logs/warns in job-endpoints to satisfy instrumentation tests.
- Run focused tests and iterate.

Validation

- Run targeted vitest tests for `Status Transformer` and `Job Endpoints` groups.
- Then run full test suite and address remaining failures.

Notes & Risks

- Keep changes minimal and local to `status-transformer.js` and `job-endpoints.js` to avoid regressions.
- Preserve existing helper functions to minimize downstream changes.
- Logging messages are currently unconditional for tests; consider gating them behind a debug flag later.
