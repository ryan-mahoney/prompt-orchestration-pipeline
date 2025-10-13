Overview with Acceptance Criteria

Acceptance checklist (JobId-only)

- [ ] Canonical route: /pipeline/:jobId everywhere; no slug routes.
- [ ] All client links pass job.id; no pipeline slug in URLs.
- [ ] useJobDetailWithUpdates fetches /api/jobs/:jobId and subscribes to SSE with ?jobId=.
- [ ] GET /api/jobs/:jobId resolves only by ID, returns 404 for non-existent, never attempts slug resolution.
- [ ] Demo storage is ID-based only: demo/pipeline-data/{pending,current,complete,rejected}/<jobId>/.
- [ ] No runtime compatibility for process/slug folders; legacy content either migrated once or ignored.
- [ ] Tests updated: success by ID, 404 for slug, SSE path uses jobId.
- [ ] Clear error states: “Invalid job ID” vs “Job not found” vs network errors.

Pragmatic Step-by-Step Plan

1. Lock UI navigation to JobId

- Files: src/components/JobTable.jsx, src/components/JobCard.jsx, tests/job-navigation.test.jsx
- Change all detail links to /pipeline/${job.id}.
- If job.id is missing, render disabled state or show tooltip; do not construct a URL from slug/name.
- Update tests to assert href contains job.id only.

2. Enforce canonical route and parameter validation

- Files: src/pages/PipelineDetail.jsx
- Ensure route remains /pipeline/:jobId.
- Add a lightweight validator for jobId (align with id-generator format if applicable). If invalid, show a “Invalid job ID” error view without calling the API.
- Ensure useJobDetailWithUpdates receives jobId only; remove any slug-based branching.

3. Fetch and SSE by JobId only

- Files: src/ui/client/hooks/useJobDetailWithUpdates.js, src/ui/sse-enhancer.js, src/ui/sse.js
- Confirm fetch is GET /api/jobs/${jobId}.
- Ensure EventSource connects to /api/events?jobId=${encodeURIComponent(jobId)}.
- Remove any code that attempts to derive jobId from a slug before connecting.
- Tests: update useJobDetailWithUpdates to verify ID flow and correct error rendering.

4. Tighten server endpoint to ID-only

- Files: src/ui/endpoints/job-endpoints.js
- GET /api/jobs/:id:
  - Validate ID format (optional but recommended).
  - Lookup strictly by ID; return 404 { ok: false, message: "Job not found" } if missing.
  - Do not attempt pipeline slug or “latest job” resolution.
- Ensure errors are explicit and consistent with UI expectations (“Failed to load job details” + specific message).
- Update integration/unit tests: 200 for valid ID, 404 for unknown ID, 404 for slug-like params.

5. Normalize demo storage to ID-based only

- Files: src/ui/job-index.js or src/ui/job-reader.js; scripts/migrate-demo-fs.js (new)
- Make readers/index assume directories are demo/pipeline-data/<stage>/<jobId>/.
- Do not scan for process/slug folders. If they exist, ignore them.
- Optional migration script:
  - Create scripts/migrate-demo-fs.js to move process-named folders to <jobId> based on embedded metadata; otherwise generate a new ID and write a manifest in the new folder.
  - Document a one-time run command in README/docs.
- Tests: update job-reader/scanner tests to only consider ID-based paths.

6. Tighten API/file utilities to ID-only

- Files: src/ui/job-scanner.js, src/ui/job-reader.js, src/ui/job-index.js
- Remove slug maps and “latestJobByPipelineSlug.”
- Keep a single source of truth: jobsById.
- Ensure performance remains fine (demo data small). Cache index per run.

7. Update docs and remove deprecated code paths

- Files: docs/plans/…, docs/demo-simplify-implemented.md, docs/project-simplify-demo.md
- Document JobId-only policy, directory layout, and migration script.
- Remove references to slug/legacy routes; if any server routes exist for legacy paths, delete them or return 410/404.

8. Final test pass and cleanup

- Files: tests/\*
- Update:
  - tests/PipelineDetail.test.jsx → success by ID; 404 error renders clear message for slug param.
  - tests/job-endpoints.integration.test.js → no slug fallback.
  - tests/sse-\* → assert ?jobId= is used and events flow.
  - tests/job-navigation.test.jsx → links contain only job.id.
- Ensure all tests pass.
