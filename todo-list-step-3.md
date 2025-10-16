# Step 3 - Demo Task Updates

## Completed Work

✅ Step 1: Core File I/O Module

- Created `createTaskFileIO` factory with comprehensive functionality
- Implemented writeArtifact/writeLog/writeTmp with modes
- Added automatic tasks-status.json updates with de-duplication
- Created comprehensive test suite (21 tests passing)
- Maintained pure functional design with closures

✅ Step 2: Inject files API into Stage Context

- Modified task-runner to create per-task fileIO singleton using createTaskFileIO
- Added statusPath to runner context in pipeline-runner.js
- Set context.files before stage invocation with proper error handling
- Ensured task folders exist on start in task-runner
- Removed legacy artifacts enumeration/writes from task-runner
- All task-runner and pipeline-runner tests passing (29/29)

✅ UI Schema Migration (Prerequisite)

- Updated job-adapter to prefer files.\* over legacy artifacts
- Modified status-transformer to handle new files.\* schema
- Updated JobDetail component to render files.\* instead of task.artifacts
- Updated tests to expect new files.\* schema
- All UI tests passing with new schema
- Updated storage.md and tasks-data-shape.md documentation

## Current Phase Objective

Update demo tasks to use the new file I/O API and showcase the new functionality.

## Implementation Requirements

### Demo Task Updates

**Files to modify:**

- `demo/pipeline-config/tasks/` - Update existing demo tasks
- Create integration tests for demo pipeline with new file I/O

**Changes needed:**

1. **Update existing demo task** to use `context.files` API:
   - Replace direct file writes with `context.files.writeArtifact()`
   - Replace logging with `context.files.writeLog()` (append mode)
   - Use `context.files.writeTmp()` for temporary files
   - Demonstrate reading files with `context.files.readArtifact()`

2. **Showcase default modes**:
   - Log files should use append mode (default for writeLog)
   - Artifact files should use replace mode (default for writeArtifact)
   - Demonstrate explicit mode usage where appropriate

3. **Add integration test**:
   - Create test that runs demo pipeline with new file I/O
   - Verify correct files.\* structure in tasks-status.json
   - Verify file placement in artifacts/, logs/, tmp/ subdirectories
   - Test file content and de-duplication behavior

### Success Criteria

- Demo tasks use new file I/O API correctly
- Files are placed in correct subdirectories (artifacts/, logs/, tmp/)
- tasks-status.json updated with proper files.\* arrays
- Integration test demonstrates end-to-end functionality
- File operations work correctly within stage context

## Next Step

After completing Step 3, proceed to Step 4 to update API endpoints to return files.\* instead of legacy artifacts.
