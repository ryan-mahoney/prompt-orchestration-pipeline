# Step 1: Confirm Current Failure Cause - TODO List

## Acceptance Criteria (from plan)

- [x] Navigating from dashboard to a job detail page uses a canonical job.id in the URL (/pipeline/:jobId), not a pipeline slug
- [x] GET /api/jobs/:id returns the job when :id is a valid job ID
- [x] Legacy/slug URLs (e.g., /pipeline/content-generation) are handled gracefully:
  - Either auto-resolve to the latest job for that pipeline and render details, or
  - Return a clear error instructing the client to use a job ID
- [x] Demo data can be read consistently regardless of old (process-named) vs new (ID-based) folder structures
- [x] The UI does not show "Failed to load job details" for valid jobs; for invalid/missing jobs, it shows an error and an actionable message
- [x] Tests cover: link targets, successful load by ID, slug fallback behavior, and error path for invalid IDs

## Step 1 Tasks

### PLAN

- [x] Read and understand the task requirements
- [ ] Inspect PipelineDetail.jsx and useJobDetailWithUpdates.js behavior
- [ ] Verify where links originate (JobTable.jsx, JobCard.jsx) to ensure they pass job.id
- [ ] Validate server route behavior in src/ui/endpoints/job-endpoints.js
- [ ] Document current state and identify failure points

### DO

- [ ] Examine current PipelineDetail.jsx implementation
- [ ] Examine current useJobDetailWithUpdates.js implementation
- [ ] Check JobTable.jsx link generation
- [ ] Check JobCard.jsx link generation
- [ ] Analyze job-endpoints.js GET /api/jobs/:id implementation
- [ ] Identify what's causing failures

### CHECK

- [ ] Run existing tests to see current failures
- [ ] Test current behavior manually if needed
- [ ] Document findings

### COMMIT

- [ ] Create conventional commit for Step 1 findings
