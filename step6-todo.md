# Step 6: Tests Updated and Added - TODO List

## Acceptance Criteria Checklist

- [ ] New orchestrator test: pending/abc123-seed.json → current/abc123/seed.json; no current/{name}/
- [ ] Update tests/upload-api.test.js to assert absence of current/{jobName}/ and presence of current/{jobId}/
- [ ] Update tests/e2e-upload.test.js to assert absence of current/{jobName}/ and presence of current/{jobId}/
- [ ] Extend tests/id-only-storage.test.js with "no name-based folders after upload"
- [ ] All tests pass: npm -s test

## Plan

### Files to Change

- `tests/orchestrator.test.js` - Add new test for ID-only seed processing
- `tests/upload-api.test.js` - Update assertions to verify ID-only folders
- `tests/e2e-upload.test.js` - Update assertions to verify ID-only folders
- `tests/id-only-storage.test.js` - Extend with negative test cases

### Test Plan

- **orchestrator.test.js**: Test that pending/{jobId}-seed.json creates only current/{jobId}/ structure
- **upload-api.test.js**: Verify upload creates ID-based folders, no name-based folders
- **e2e-upload.test.js**: Verify end-to-end upload creates ID-based folders only
- **id-only-storage.test.js**: Add test to ensure no name-based folders after upload

### Risks & Mitigations

- **Risk**: Existing tests may have hardcoded expectations for name-based folders
- **Mitigation**: Carefully update test assertions to match new ID-only behavior
- **Risk**: Test data may need updating to use proper ID format
- **Mitigation**: Review and update test fixtures to use valid job IDs
