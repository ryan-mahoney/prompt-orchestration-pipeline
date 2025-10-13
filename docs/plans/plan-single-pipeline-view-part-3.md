Overview and Acceptance Criteria

Acceptance checklist

- [ ] Navigating from dashboard to a job detail page uses a canonical job.id in the URL (/pipeline/:jobId), not a pipeline slug
- [ ] GET /api/jobs/:id returns the job when :id is a valid job ID
- [ ] Legacy/slug URLs (e.g., /pipeline/content-generation) are handled gracefully:
  - Either auto-resolve to the latest job for that pipeline and render details, or
  - Return a clear error instructing the client to use a job ID
- [ ] Demo data can be read consistently regardless of old (process-named) vs new (ID-based) folder structures
- [ ] The UI does not show “Failed to load job details” for valid jobs; for invalid/missing jobs, it shows an error and an actionable message
- [ ] Tests cover: link targets, successful load by ID, slug fallback behavior, and error path for invalid IDs

Pragmatic Step-by-Step Plan

1. Confirm current failure cause

- Inspect PipelineDetail.jsx and useJobDetailWithUpdates.js behavior (already indicated: route /pipeline/:jobId; fetch /api/jobs/${jobId})
- Verify where links originate (JobTable.jsx, JobCard.jsx) to ensure they pass job.id, not pipeline slug
- Validate server route behavior in src/ui/endpoints/job-endpoints.js: confirm GET /api/jobs/:id lookup logic and error messages

2. Fix client navigation to always use job.id

- Files: src/components/JobTable.jsx, src/components/JobCard.jsx (and any other job link emitters)
- Change link target to /pipeline/${job.id}
- If a job object might lack id, render disabled/tooltip state rather than constructing a slug URL
- Minimal UI change; immediate improvement even without server fallback

3. Harden server endpoint GET /api/jobs/:id for ID resolution

- File: src/ui/endpoints/job-endpoints.js
- Ensure the endpoint:
  - Tries to load by exact job ID first
  - If not found and param looks like a known pipeline slug, optionally resolve to latest job for that slug (compatibility path)
  - Responds with:
    - 200 { ok: true, data: job } when found
    - 404 { ok: false, message: "Job not found" } when not resolvable
    - 400 { ok: false, message: "Invalid ID format" } if needed

4. Add a simple demo data index to support both folder styles

- Files: src/ui/job-scanner.js and/or src/ui/job-reader.js (or introduce src/ui/job-index.js)
- On startup (or first access), scan demo/pipeline-data/{current,complete}:
  - Build maps:
    - jobsById: { [jobId]: { path, meta } }
    - latestJobByPipelineSlug: { [slug]: jobId }
  - Old structure handling:
    - If encountering process-named folders, extract metadata (e.g., seed file content with id if present, or derive a stable ID scheme)
  - Provide functions:
    - getJobById(id): job or null
    - getLatestJobByPipelineSlug(slug): job or null
- Use this index in job-endpoints to make lookups consistent and fast
- Optional: watch for FS changes or rebuild lazily on demand

5. Optional: canonicalize slug routes in the client

- Keep route path as /pipeline/:jobId for canonical URLs
- Optionally allow /pipeline/:idOrSlug on the client:
  - If the param fails a basic ID predicate (e.g., known pattern for generated IDs), call a new resolve endpoint: GET /api/jobs/resolve/:idOrSlug → { jobId }
  - Upon resolving, navigate to /pipeline/:jobId
- This preserves UX for any saved legacy links while converging to canonical routes

6. Validate SSE compatibility

- Files: src/ui/sse.js, src/ui/sse-enhancer.js, src/ui/client/hooks/useJobDetailWithUpdates.js
- Confirm EventSource URL uses ?jobId=<id> and server filters events by ID
- Ensure the resolution path above (slug → id) occurs before establishing SSE so events match the canonical job ID

7. Update and add tests

- UI tests:
  - tests/PromptPipelineDashboard.test.jsx or JobTable-related: assert link href uses /pipeline/<job.id>
  - tests/PipelineDetail.test.jsx: success case with valid ID renders details; legacy slug path either redirects/resolves or shows a clear error
- Endpoint tests:
  - tests/job-endpoints.integration.test.js: GET /api/jobs/:id returns 200 for valid ID; 404 for unknown; compatibility lookup for slug returns 200 or 404 per configuration
- Hook tests:
  - tests/useJobDetailWithUpdates.test.jsx: still works with ID, including SSE hydration

8. Provide a migration path (optional but recommended)

- Script (optional new file under scripts/): migrate process-named folders into ID-based folders and update any references
- Document in docs/demo-simplify-implemented.md or new doc section:
  - “Demo data indexing and migration”
  - Commands and rollback plan

9. Rollback and safety

- If slug resolution creates ambiguity, feature-flag it:
  - Add env flag (e.g., DEMO_ALLOW_SLUG_RESOLUTION=true) to enable legacy compatibility
  - Default to strict ID-only to avoid unexpected matches in production
- Maintain clear error messages to avoid silent failures

File Change List (with purpose)

- src/components/JobTable.jsx → Ensure links use /pipeline/${job.id}
- src/components/JobCard.jsx → Ensure links use /pipeline/${job.id}
- src/ui/endpoints/job-endpoints.js → ID-first lookup; optional slug compatibility; clearer errors
- src/ui/job-reader.js or new src/ui/job-index.js → Build and expose jobsById and latestJobByPipelineSlug
- src/pages/PipelineDetail.jsx → Confirm route and behavior; optionally add slug canonicalization logic (client-side resolution) if chosen
- tests/\* → Add/update tests per above
- docs/\* → Document behavior and migration

Risks and mitigations

- Ambiguity when mapping a slug to “latest job”
  - Mitigate with a feature flag; log which job ID was chosen; prefer strict ID-only in production
- Demo FS scan performance
  - Index lazily and cache; the demo data set is small; add a watcher if needed
- SSE mismatch if slug used during connection
  - Always resolve to ID before connecting EventSource

This plan aims to fix the immediate issue (bad URL param) with minimal changes, while adding a compatibility layer and a clear path to fully ID-based routing and storage.
