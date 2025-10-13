# Step 3: Fetch and SSE by JobId only - Implementation Plan

## Current Analysis

Looking at the current code:

1. **useJobDetailWithUpdates.js**: Already correctly uses `/api/jobs/${jobId}` and `/api/events?jobId=${encodeURIComponent(jobId)}`
2. **sse-enhancer.js**: Works with jobId-based events, no slug resolution needed
3. **sse.js**: Already has jobId filtering logic in broadcast function
4. **Tests**: Already test jobId-based filtering and API calls

## Acceptance Checklist

- [x] Confirm fetch is GET /api/jobs/${jobId} - ✅ Already implemented
- [x] Ensure EventSource connects to /api/events?jobId=${encodeURIComponent(jobId)} - ✅ Already implemented
- [x] Remove any code that attempts to derive jobId from a slug before connecting - ✅ No slug resolution found
- [x] Update useJobDetailWithUpdates tests to verify ID flow and correct error rendering - ✅ Already comprehensive
- [x] Verify SSE filtering works correctly by jobId - ✅ Already implemented
- [x] Run tests to ensure everything works as expected

## Files to Examine/Update

- [x] src/ui/client/hooks/useJobDetailWithUpdates.js - Already correct
- [x] src/ui/sse-enhancer.js - Already correct
- [x] src/ui/sse.js - Already correct
- [x] tests/useJobDetailWithUpdates.test.jsx - Already comprehensive
- [x] src/ui/endpoints/job-endpoints.js - Updated to remove slug resolution
- [x] tests/job-endpoints.integration.test.js - Updated to reflect new behavior
- [x] Run test suite to verify current implementation

## Implementation Steps

1. ✅ Verify current implementation meets all requirements
2. ✅ Run tests to ensure everything works
3. ✅ Remove slug resolution from job endpoints
4. ✅ Update tests to reflect new behavior
5. ✅ Verify all tests pass (39/39 tests passing)

## Summary

Step 3 has been successfully implemented. The key changes made:

1. **Job Endpoints**: Removed all slug resolution logic from `handleJobDetail()` function
2. **API Behavior**: Now only accepts valid job IDs and returns 400 for invalid formats
3. **SSE Integration**: Already correctly implemented with jobId-based filtering
4. **Tests**: Updated all relevant tests to reflect the new jobId-only behavior
5. **Validation**: All 39 tests passing across SSE, hooks, and endpoint tests

The system now enforces strict jobId-only access as required by the plan.
