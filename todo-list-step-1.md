# Step 1: Add functional file I/O module with files.\* updates

## Implementation Checklist

### Plan Phase

- [x] Analyze existing file I/O patterns and tasks-status.json structure
- [x] Review testing requirements from testing-guardrails.md
- [x] Design createTaskFileIO factory interface
- [x] Plan test cases for all functionality

### Do Phase

- [x] Create src/core/file-io.js with createTaskFileIO factory
- [x] Implement writeArtifact, writeLog, writeTmp functions
- [x] Implement readArtifact, readLog, readTmp functions
- [x] Add directory creation logic
- [x] Add tasks-status.json update logic with de-duplication
- [x] Create tests/file-io.test.js with comprehensive test coverage
- [x] Test all functionality with per-test temp dirs

### Check Phase

- [x] Run tests to ensure all pass deterministically
- [x] Verify file operations work correctly
- [x] Verify tasks-status.json updates with correct schema
- [x] Check for any global state or side effects

### Commit Phase

- [x] Create conventional commit for Step 1 completion
- [x] Verify commit message follows project standards

## Files to Create/Modify

- [x] src/core/file-io.js (new)
- [x] tests/file-io.test.js (new)

## Key Requirements

- Factory function with curried operations
- Stage-scoped file operations (artifacts/, logs/, tmp/)
- tasks-status.json updates with de-duped arrays
- Pure functional with closures (no global state)
  Comprehensive test coverage with temp dirs
