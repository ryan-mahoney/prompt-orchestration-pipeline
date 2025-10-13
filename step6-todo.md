# Step 6 TODO List: Tests updated and added

## Acceptance Criteria

- [x] New orchestrator test: pending/abc123-seed.json → current/abc123/seed.json; no current/{name}/
- [ ] Update tests/upload-api.test.js to assert absence of current/{jobName}/ and presence of current/{jobId}/
- [ ] Update tests/e2e-upload.test.js to assert absence of current/{jobName}/ and presence of current/{jobId}/
- [ ] Extend tests/id-only-storage.test.js with "no name-based folders after upload"
- [ ] Run npm -s test: all green

## File Change List

- tests/orchestrator.test.js → Add new test for ID-only seed processing
- tests/upload-api.test.js → Update assertions for ID-only folders
- tests/e2e-upload.test.js → Update assertions for ID-only folders
- tests/id-only-storage.test.js → Add test for no name-based folders

## Test Plan

- "processes pending seed file with valid job ID" → Tests orchestrator creates current/{jobId}/ structure
- "upload API creates only ID-based folders" → Tests upload endpoint doesn't create name-based folders
- "e2e upload creates only ID-based folders" → Tests end-to-end upload flow
- "storage ignores name-based folders" → Tests readers/scanners reject non-ID folders

## Risks & Mitigations

- Risk: Existing tests may expect name-based folders
- Mitigation: Carefully update test assertions to match new ID-only behavior
- Risk: Test setup may create name-based fixtures
- Mitigation: Update test fixtures to use ID-based naming
