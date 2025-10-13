# Step 3: Harden server endpoint GET /api/jobs/:id for ID resolution

## Acceptance Checklist (from Step 3 requirements)

- [ ] ID-first lookup: Try to load by exact job ID first
- [ ] Slug compatibility: If not found and param looks like a pipeline slug, resolve to latest job for that slug
- [ ] Proper response codes: 200 for success, 404 for not found, 400 for invalid format
- [ ] Clear error messages for different failure scenarios
- [ ] Tests cover: valid ID lookup, slug resolution, invalid formats, not found scenarios

## Implementation Plan

### SECTION: PLAN

**File Change List (path → purpose):**

- `tests/job-endpoints.integration.test.js` → Add tests for slug resolution functionality
- `src/ui/endpoints/job-endpoints.js` → Implement hardened handleJobDetail with slug fallback
- `src/ui/job-index.js` (new) → Create job indexing utilities for slug-to-ID resolution

**Test Plan (test names → what they assert):**

- `should resolve valid job ID successfully` → ID-first lookup works
- `should resolve pipeline slug to latest job` → Slug fallback works when ID fails
- `should return 404 for unknown slug` → Proper error when slug has no jobs
- `should return 400 for invalid slug format` → Validation catches bad slugs
- `should prefer ID lookup over slug when both exist` → ID precedence maintained
- `should handle mixed ID/slug scenarios correctly` → Edge cases covered

**Risks & Mitigations:**

- **Risk**: Slug ambiguity when multiple jobs exist for same pipeline
- **Mitigation**: Always return "latest" job (most recent by update time)
- **Risk**: Performance impact from scanning all jobs for slug resolution
- **Mitigation**: Build and cache index lazily, demo dataset is small
- **Risk**: Backward compatibility break
- **Mitigation**: Keep existing ID behavior unchanged, add slug as optional fallback

### SECTION: DO

**Test Changes Summary:**

- Add comprehensive test cases for slug resolution
- Mock job scanner and reader for deterministic behavior
- Test both success and failure scenarios
- Verify proper HTTP response codes and messages

**Code Changes Summary:**

- Create job indexing utilities to build slug-to-ID mapping
- Modify handleJobDetail to try ID first, then slug fallback
- Add helper functions for slug validation and resolution
- Maintain backward compatibility with existing ID behavior

### SECTION: CHECK

**Test Command:** `npm -s test`
**Expected Results:** All existing tests pass + new slug resolution tests pass

### SECTION: COMMIT

**Conventional Commit:** `feat(api): add slug resolution to job detail endpoint`

**Files Changed:**

- `src/ui/endpoints/job-endpoints.js` - Added slug fallback logic
- `src/ui/job-index.js` - New job indexing utilities
- `tests/job-endpoints.integration.test.js` - Added slug resolution tests
