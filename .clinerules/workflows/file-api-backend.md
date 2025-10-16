<task_objective>
Implement a backend API endpoint to list and read task-scoped files under artifacts/, logs/, and tmp/ in a single JSON endpoint, with full validation, safe path jailing, MIME/encoding selection, comprehensive tests, and concise docs. The workflow must run from start to finish with no human interaction, automatically choosing the most pragmatic approach, creating/modifying files as needed, and making a Conventional Commit at the end of each step. Each step runs in a fresh context, so carry forward the branch name, endpoint contract, error shape, route ordering, and test expectations between steps.
</task_objective>

<detailed_sequence_of_steps>

1. Bootstrap: create feature branch

- Why
  - Isolate the change set to deliver the smallest safe increment, easy to review and roll back.
- What
  - Create branch rpm-task-file-api to house the API, tests, and docs.
  - Record baseline (no code change).
- How to test
  - None; verify branch presence.
- Files changed
  - None.
- Acceptance criteria
  - New branch rpm-task-file-api exists locally.
- Risk & Rollback
  - Minimal; delete branch or switch back to main.
- Conventional Commit
  - chore(repo): start branch rpm-task-file-api

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-api
- Objective: Add JSON-only file-read endpoint for task files with strict validation and jail checks.

Constraints to retain:

- Route path: GET /api/jobs/:jobId/tasks/:taskId/file?type=artifacts|logs|tmp&filename=<relative>
- Error shape: { ok:false, error, message } with proper HTTP status
- MIME guess by extension; fallback application/octet-stream
- Encoding: "utf8"
- Search job in current then complete
- Route must be placed before generic /api/jobs/:jobId to avoid shadowing
  </context>
  </new_task>

2. Add failing integration tests (spec-first)

- Why
  - Lock in endpoint behavior and JSON shapes; prevent regressions.
- What
  - Create tests/job-file-endpoint.integration.test.js:
    - Start server with per-test temp PO_ROOT and port 0.
    - Create a fake job at pipeline-data/current/{jobId}/tasks/{taskId}/{artifacts|logs|tmp}.
    - Seed:
      - artifacts/output.json (UTF-8 JSON text)
      - logs/test.log (UTF-8 text)
      - tmp/blob.bin (binary)
    - Cases:
      - 200 artifacts UTF-8 JSON → ok:true, correct fields, mime "application/json", encoding "utf8", content contains seeded key.
      - 200 logs UTF-8 text → mime "text/plain", encoding "utf8", exact content match.
      - 200 tmp binary → mime fallback application/octet-stream, encoding "base64", content decodes to original bytes.
      - 400 validation (missing/empty/invalid type/filename) → { ok:false, error:"bad_request" }.
      - 403 jail attempts (e.g., ../secret.txt, absolute/drive paths) → { ok:false, error:"forbidden" }.
      - 404 not found (missing job/task/file) → { ok:false, error:"not_found" }.
      - Fallback to complete if not present in current but present in complete.
- How to test
  - Run the test file; expect failures until implementation is added.
- Files changed
  - tests/job-file-endpoint.integration.test.js (new)
- Acceptance criteria
  - Tests compile and fail with unmet endpoint behavior, clearly defining the contract.
- Risk & Rollback
  - None; test-only change.
- Conventional Commit
  - test(api): specify integration cases for task file read endpoint

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-api
- Integration tests added and failing by design.
- Endpoint contract and error shape as specified.

Next goal:

- Implement the endpoint and shared error helper in src/ui/server.js to satisfy tests.
- Maintain JSON-only responses and route ordering above /api/jobs/:jobId.
  </context>
  </new_task>

3. Implement endpoint and error/MIME helpers

- Why
  - Provide a single, robust JSON endpoint to read per-task files with safety and predictable behavior.
- What
  - In src/ui/server.js:
    - Add a small helper to send JSON errors consistently with shape { ok:false, error, message } and proper status code.
    - Add a minimal, explicit extension→MIME map with safe fallback application/octet-stream.
    - Add a text-mime predicate (text/\*, application/json, application/javascript, application/xml, image/svg+xml, application/x-ndjson, text/csv, text/markdown).
    - Insert the new route handler BEFORE the generic /api/jobs/:jobId route:
      - Match GET /api/jobs/:jobId/tasks/:taskId/file with query params type and filename.
      - Validate jobId, taskId non-empty; type ∈ {artifacts, logs, tmp}; filename non-empty.
      - Resolve candidate job dirs in order: current then complete (reuse resolvePipelinePaths/getJobDirectoryPath).
      - Build target path: <jobDir>/tasks/<taskId>/<type>/<filename>.
      - Jail checks:
        - Reject filenames containing traversal (".."), leading slashes/backslashes, or drive letters.
        - Resolve full path and ensure it startsWith the intended base dir.
      - If file exists and is regular:
        - Decide mime by extension (fallback to application/octet-stream).
        - If text-like mime: read UTF-8, encoding "utf8".
        - Else: read as Buffer and return Base64 with encoding "base64".
        - Respond 200 JSON with fields: ok, jobId, taskId, type, path (tasks/{taskId}/{type}/{filename}), mime, size, mtime, encoding, content.
      - On not found after both locations: 404 with { ok:false, error:"not_found" }.
      - On invalid input: 400 with { ok:false, error:"bad_request" }.
      - On jail violation: 403 with { ok:false, error:"forbidden" }.
      - On unexpected errors: 500 with { ok:false, error:"internal_error" }.
- How to test
  - Re-run the integration tests; they should now pass for covered cases.
- Files changed
  - src/ui/server.js (modify: add helpers; insert new route above generic job route; small comments about ordering and jail logic)
- Acceptance criteria
  - The new route returns JSON-only responses; passes the earlier integration tests; ordering avoids shadowing.
- Risk & Rollback
  - Route ordering is sensitive; placing the route earlier avoids conflicts. Rollback by removing the new route block.
- Conventional Commit
  - feat(api): add JSON task file endpoint with validation, jail checks, and MIME/encoding

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-api
- Endpoint implemented with standardized error shape and MIME/encoding selection.
- Tests from step 2 passing for core scenarios.

Next goal:

- Harden with additional negative/edge tests for traversal normalization and MIME fallback.
  </context>
  </new_task>

4. Add negative/edge coverage

- Why
  - Reduce risk of path traversal bypass and MIME/encoding misclassification.
- What
  - Update tests/job-file-endpoint.integration.test.js:
    - Test nested paths like "sub/../output.json" that normalize inside the jail and should succeed.
    - Test traversal escaping outside base dir (e.g., "../../outside.json") that must be forbidden.
    - Test unknown/no extension files:
      - With non-UTF-8 bytes → expect application/octet-stream and base64 encoding.
      - With UTF-8 bytes but unknown ext → allow utf8 if mime map considers text-only by extension; otherwise base64 fallback remains acceptable per policy.
    - Test larger UTF-8 text files return complete content and accurate size.
- How to test
  - Run the updated test file; ensure green.
- Files changed
  - tests/job-file-endpoint.integration.test.js (update)
- Acceptance criteria
  - All new edge cases pass deterministically; no flakiness; traversal is safely jailed.
- Risk & Rollback
  - None; test-only change.
- Conventional Commit
  - test(api): harden endpoint with path traversal and MIME fallback cases

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-api
- Endpoint + tests are green and cover core + edge cases.
- Behavior: JSON-only, jailed paths, current→complete fallback.

Next goal:

- Add concise developer documentation for the new endpoint, including request/response examples and error codes.
  </context>
  </new_task>

5. Add documentation and small polish

- Why
  - Make the endpoint discoverable and reduce misuse.
- What
  - Create docs/read-task-file.md:
    - Overview and purpose.
    - Endpoint and parameters:
      - GET /api/jobs/:jobId/tasks/:taskId/file
      - Query: type=artifacts|logs|tmp, filename=<relative>
    - Success response examples for UTF-8 text, including all fields (ok, jobId, taskId, type, path, mime, size, mtime, encoding, content).
    - Error responses with HTTP codes:
      - 400 bad_request (validation)
      - 403 forbidden (jail)
      - 404 not_found (missing)
      - 500 internal_error (unexpected)
    - Notes:
      - MIME guessed by extension; fallback application/octet-stream
      - Encoding "utf8" for text-like mimes
      - Lookup order: current, then complete
  - Optional: add brief comments in src/ui/server.js near the new route explaining ordering and jail checks.
- How to test
  - None programmatic; check docs render and content correctness.
- Files changed
  - docs/read-task-file.md (new)
  - src/ui/server.js (comments only, optional)
- Acceptance criteria
  - Documentation exists with accurate examples and constraints; no behavioral code changes.
- Risk & Rollback
  - None.
- Conventional Commit
  - docs(api): document task file read endpoint with examples and error shapes

<new_task>
<context>
Carry-over:

- Branch: rpm-task-file-api
- Endpoint implemented, tests green, and docs added.

Final goal:

- Full suite verification and bookkeeping; ensure no new deps and route ordering intact.
  </context>
  </new_task>

6. Final verification

- Why
  - Ensure repository remains green and changes are production-ready.
- What
  - Run full test suite; confirm all tests pass deterministically.
  - Optionally run lint (if configured) and address issues.
  - Confirm route ordering (file endpoint above generic job endpoint).
  - Confirm no new dependencies were added.
- How to test
  - Execute the full test command; verify green build.
- Files changed
  - None unless minor formatting comments were added.
- Acceptance criteria
  - All tests pass; repository linting is clean; no new deps; route order verified.
- Risk & Rollback
  - Minimal risk; revert last small changes if needed.
- Conventional Commit
  - chore(repo): finalize task file API (tests green)

</detailed_sequence_of_steps>

<new_task>
<context>
Final handoff summary:

- Branch: rpm-task-file-api
- Endpoint added: GET /api/jobs/:jobId/tasks/:taskId/file?type=artifacts|logs|tmp&filename=<relative>
- Behavior:
  - Validates inputs; JSON-only responses
  - Safe path jailing; rejects traversal and absolute/drive paths
  - Looks in current then complete
  - MIME guessed by extension; fallback application/octet-stream
  - encoding "utf8" for text-like; "base64" for others
  - Response: { ok, jobId, taskId, type, path, mime, size, mtime, encoding, content }
  - Error shape: { ok:false, error, message } with appropriate status code
- Tests:
  - Integration tests cover validation, jail, not-found, MIME/encoding correctness, and fallback to complete
  - Additional edge cases for traversal normalization and MIME fallback
- Docs:
  - docs/read-task-file.md with examples and error codes
- No new dependencies; route ordering confirmed; full suite green
  Proceed to open a PR following repo standards with Conventional Commits summary and the provided docs link.
  </context>
  </new_task>
