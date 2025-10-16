# feat(core): implement scoped file I/O system with breaking schema changes

## Why

Replace the legacy artifacts system with a more organized, stage-scoped file I/O approach that provides better isolation, automatic status tracking, and cleaner file organization for pipeline tasks.

## What Changed

### Core File I/O System

- **New module**: `src/core/file-io.js` - `createTaskFileIO` factory with curried functions
- **File organization**: Tasks now get isolated `artifacts/`, `logs/`, and `tmp/` subdirectories
- **Automatic status updates**: `tasks-status.json` now includes `files.*` arrays with de-duplication
- **Modes**: `replace` (default for artifacts/tmp) and `append` (default for logs)

### Task Runner Integration

- **Context injection**: `context.files` API available to all task stages
- **Legacy removal**: Replaced `context.artifacts` enumeration with `context.files.writeArtifact`
- **Status path**: Added `statusPath` to runner context for file I/O updates
- **Folder creation**: Automatic task directory structure creation

### Schema Breaking Changes

- **Old**: `task.artifacts` array with file objects
- **New**: `task.files.artifacts` array with filenames only
- **Old**: Files stored in task root directory
- **New**: Files organized in `artifacts/`, `logs/`, `tmp/` subdirectories
- **Status file**: Added `files.artifacts|logs|tmp` arrays at job and task levels

### UI Component Updates

- **JobDetail**: Now renders `files.*` instead of `task.artifacts`
- **Job adapter**: Updated to prefer `files.*` over legacy artifacts
- **Status transformer**: Handles new schema migration transparently
- **API endpoints**: Return new schema without legacy artifacts fields

### Demo Task Updates

- **Analysis task**: Updated to use `context.files.writeArtifact/writeLog`
- **Integration patterns**: Showcases proper file I/O usage with default modes
- **Verification**: Demo generates correct file structure and status updates

### Migration Tooling

- **Script**: `scripts/migrate-demo-files.js` for existing data migration
- **Tests**: Comprehensive migration validation (3 tests passing)
- **Safety**: Preserves all existing data while updating schema

## Files Modified

### Core Implementation

- `src/core/file-io.js` (new) - File I/O factory and operations
- `src/core/task-runner.js` - Context.files injection and legacy removal
- `src/core/pipeline-runner.js` - Status path integration

### UI Components

- `src/components/JobDetail.jsx` - Render files.\* instead of task.artifacts
- `src/ui/client/adapters/job-adapter.js` - Prefer files.\* schema
- `src/ui/transformers/status-transformer.js` - Handle new schema
- `src/ui/endpoints/job-detail-endpoint.js` - Return new schema

### Demo and Examples

- `demo/pipeline-config/tasks/analysis/index.js` - Use new file I/O API
- `scripts/migrate-demo-files.js` (new) - Migration script

### Documentation

- `README.md` - Added Section D: File I/O System documentation
- `docs/storage.md` - Updated schema documentation
- `docs/tasks-data-shape.md` - New files.\* arrays schema

### Tests (882 passing, 10 skipped)

- `tests/file-io.test.js` (new) - 21 tests for file I/O module
- `tests/file-io-integration.test.js` (new) - 5 integration tests
- `tests/demo-fileio-integration.test.js` (new) - 2 demo pattern tests
- `tests/migrate-demo-files.test.js` (new) - 3 migration tests
- Updated all existing tests to expect new schema

## How Was This Tested

### Unit Tests

- **File I/O module**: 21 tests covering write/read operations, modes, de-duplication
- **Task runner**: 28 tests updated for new context.files behavior
- **Migration script**: 3 tests for data migration scenarios

### Integration Tests

- **Demo patterns**: 2 tests simulating real analysis task file I/O
- **API endpoints**: 5 tests verifying new schema responses
- **UI components**: 29 tests confirming proper file rendering

### End-to-End Validation

- **Full suite**: 882 tests passing, 10 skipped (no regressions)
- **Demo pipeline**: Generates correct file structure and status updates
- **Migration script**: Successfully processes existing demo data
- **UI verification**: Job details display files from new schema correctly

## Risks & Rollback

### Breaking Changes

- **Schema incompatibility**: Legacy `task.artifacts` no longer supported
- **File locations**: Files moved to task-specific subdirectories
- **API responses**: Legacy artifacts fields removed from endpoints

### Mitigations

- **Migration script**: `node scripts/migrate-demo-files.js` handles existing data
- **Comprehensive tests**: 882 tests ensure no regressions
- **Documentation**: Detailed migration guide in README Section D

### Rollback Plan

1. Revert task-runner to use legacy artifacts enumeration
2. Restore job-adapter and status transformer to old schema
3. Remove file-io.js module and related tests
4. Update JobDetail component to render task.artifacts
5. Restore API endpoints to return legacy artifacts

## Performance & Security

### Performance

- **File operations**: Async with proper error handling
- **Status updates**: De-duplication prevents unnecessary writes
- **Memory**: No global state, pure functional design

### Security

- **Path validation**: All file operations scoped to task directories
- **Atomic writes**: Prevents partial file corruption
- **No eval**: Safe JSON parsing and string operations

## Migration Path for Users

### For New Users

- Use `context.files.writeArtifact/writeLog/writeTmp` in tasks
- Files automatically organized in `artifacts/`, `logs/`, `tmp/`
- Status file updated with `files.*` arrays

### For Existing Users

1. **Backup**: Save existing `pipeline-data/` directory
2. **Run migration**: `node scripts/migrate-demo-files.js`
3. **Update tasks**: Replace `context.artifacts` usage with `context.files`
4. **Verify**: Check UI shows files correctly and status schema updated

### Code Changes Required

**Old pattern:**

```javascript
// Legacy artifacts (no longer supported)
context.artifacts.push({ name: "output.json", content: data });
```

**New pattern:**

```javascript
// New file I/O API
await context.files.writeArtifact("output.json", data);
```

## Checklist

- [x] File I/O module implemented with comprehensive tests
- [x] Task runner integration with context.files injection
- [x] UI components updated to render new schema
- [x] API endpoints returning new files.\* schema
- [x] Migration script with validation tests
- [x] Demo task updated to showcase new patterns
- [x] Documentation updated with migration guide
- [x] Full test suite passing (882/892)
- [x] README includes verification steps
- [x] Breaking changes clearly documented
