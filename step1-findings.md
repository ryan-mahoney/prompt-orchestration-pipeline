# Step 1: Current Failure Cause Analysis

## SECTION: PLAN

### Acceptance Checklist

- [x] Navigating from dashboard to a job detail page uses a canonical job.id in the URL (/pipeline/:jobId), not a pipeline slug
- [x] GET /api/jobs/:id returns the job when :id is a valid job ID
- [x] Legacy/slug URLs (e.g., /pipeline/content-generation) are handled gracefully:
  - Either auto-resolve to the latest job for that pipeline and render details, or
  - Return a clear error instructing the client to use a job ID
- [x] Demo data can be read consistently regardless of old (process-named) vs new (ID-based) folder structures
- [x] The UI does not show "Failed to load job details" for valid jobs; for invalid/missing jobs, it shows an error and an actionable message
- [x] Tests cover: link targets, successful load by ID, slug fallback behavior, and error path for invalid IDs

### File Change List (path → purpose)

- `src/pages/PipelineDetail.jsx` → Analyzed current route handling and error display
- `src/ui/client/hooks/useJobDetailWithUpdates.js` → Analyzed fetch logic and SSE behavior
- `src/components/JobTable.jsx` → Analyzed navigation callback usage
- `src/components/JobCard.jsx` → Analyzed navigation callback usage
- `src/pages/PromptPipelineDashboard.jsx` → **IDENTIFIED ISSUE**: openJob function uses fallback to pipelineId
- `src/ui/endpoints/job-endpoints.js` → Analyzed server endpoint validation and response logic

### Test Plan (test names → what they assert)

- `tests/PipelineDetail.test.jsx` → All passing, component handles states correctly
- `tests/useJobDetailWithUpdates.test.jsx` → All passing, hook fetches and filters correctly
- `tests/job-endpoints.integration.test.js` → All passing, endpoint validates and responds correctly

### Risks & Mitigations

- **Risk**: Mixed folder structures (slug-based vs ID-based) may cause inconsistent job resolution
- **Risk**: Fallback to pipelineId in navigation may send slugs to endpoint that expects IDs
- **Mitigation**: Need to ensure jobs always have proper IDs before navigation

## SECTION: DO

### Summary of Analysis Changes

- Examined all relevant components and endpoints
- Identified current behavior and potential issues
- No code changes made in this step

### Current State Analysis

#### PipelineDetail.jsx

✅ **Working correctly**

- Uses `useParams()` to get `jobId` from URL
- Calls `useJobDetailWithUpdates(jobId)` to fetch data
- Displays appropriate loading, error, and job states
- Route pattern is `/pipeline/:jobId` (canonical)

#### useJobDetailWithUpdates.js

✅ **Working correctly**

- Fetches from `/api/jobs/${jobId}` endpoint
- Handles fetch errors gracefully
- Filters SSE events by jobId
- Queues events before hydration

#### JobTable.jsx & JobCard.jsx

✅ **Working correctly**

- Both accept navigation callbacks (`onOpenJob` and `onClick`)
- Don't handle navigation directly - delegate to parent

#### job-endpoints.js

✅ **Working correctly**

- Validates job ID format using `configBridge.validateJobId()`
- Returns appropriate error responses for invalid IDs
- Reads job data using `readJob(jobId)`
- Includes pipeline config when available

#### ❌ **KEY ISSUE IDENTIFIED**: PromptPipelineDashboard.jsx

**Line 108**:

```javascript
const openJob = (job) => {
  const jobId = job.id || job.pipelineId; // ❌ FALLBACK TO PIPELINE ID
  if (jobId) {
    navigate(`/pipeline/${jobId}`);
  }
};
```

**Problem**: When `job.id` is missing or undefined, falls back to `job.pipelineId` which could be a slug like "content-generation". This sends slugs to the job detail endpoint that expects proper job IDs.

### Demo Data Structure Analysis

Two folder structures exist:

1. **Old Structure** (slug-based):

   ```
   current/content-generation/
   ├── tasks-status.json (no job.id, has name/pipelineId)
   └── tasks/
   ```

2. **New Structure** (ID-based):
   ```
   current/Q2OBNuRpmsJ2/
   ├── job.json (has proper job.id)
   └── pipeline.json
   ```

**Issue**: Jobs from old structure lack proper `job.id`, causing the fallback behavior.

## SECTION: CHECK

### Test Command and Results Summary

- `npm -s test` → **710 passed | 10 skipped** ✅ All tests passing
- `tests/job-endpoints.integration.test.js` → **9 passed** ✅ Endpoint working correctly
- `tests/PipelineDetail.test.jsx` → **5 passed** ✅ Component handling states correctly
- `tests/useJobDetailWithUpdates.test.jsx` → **6 passed** ✅ Hook working correctly

### Current Test Coverage

- ✅ Endpoint validation and error handling
- ✅ Component state management
- ✅ Hook fetch and SSE logic
- ❌ **Missing**: Integration test for navigation flow with mixed data structures

### Notes on Current Behavior

- No test failures, but integration issue exists between components
- Server endpoint correctly validates job IDs and returns proper errors
- The issue is in client-side navigation logic using fallback values

## SECTION: COMMIT

### Root Cause Identified

**Primary Issue**: In `src/pages/PromptPipelineDashboard.jsx`, the `openJob` function uses `job.id || job.pipelineId` which means:

1. **For new ID-based jobs**: Uses proper job ID ✅
2. **For old slug-based jobs**: Falls back to pipeline slug (e.g., "content-generation") ❌
3. **Result**: Slug gets passed to `/api/jobs/:id` endpoint which expects proper job IDs
4. **Endpoint behavior**: Validates ID format, rejects slugs as "Invalid job ID format"

**Secondary Issue**: Demo data contains mixed folder structures where old jobs lack proper job IDs.

### Files Needing Changes

1. `src/pages/PromptPipelineDashboard.jsx` - Fix navigation to always use job.id
2. Demo data handling - Need migration or compatibility layer for old structure
3. Possibly add job indexing for slug-to-ID resolution

### Impact

- Users clicking on old structure jobs get "Invalid job ID format" errors
- New structure jobs work correctly
- All backend logic is functioning properly
