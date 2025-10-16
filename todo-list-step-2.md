# Step 2 - Inject files API into stage context via task-runner

## Completed Work

✅ Step 1: Created createTaskFileIO factory with comprehensive tests

- File: `src/core/file-io.js` - Functional file I/O module with stage-scoped operations
- Tests: `tests/file-io.test.js` - Complete unit test coverage
- Features: writeArtifact/writeLog/writeTmp, read operations, status updates, de-duplication
- Commit: "feat(core): add createTaskFileIO factory for stage-scoped file operations"

✅ UI Schema Migration (Step 2 prerequisite)

- Updated: src/ui/client/adapters/job-adapter.js - Now prefers files.\* over legacy artifacts
- Updated: src/ui/transformers/status-transformer.js - Handles new files.\* schema
- Updated: src/components/JobDetail.jsx - Renders files.\* instead of task.artifacts
- Updated: tests/job-adapter.array-tasks.test.js - Tests expect new files.\* schema
- All UI tests passing

## Current Phase Objective

Inject the files API into stage context so task functions can use file operations.

## Implementation Requirements

### Task Runner Modifications

**Files to modify:**

- `src/core/task-runner.js` - Add files API injection
- `src/core/pipeline-runner.js` - Pass statusPath to runner context

**Changes needed:**

1. **Add statusPath to runner context** (pipeline-runner.js)
   - Pass `statusPath` to task-runner context
   - Context should include: `{ workDir, taskName, getStage, statusPath }`

2. **Inject files API into stage context** (task-runner.js)
   - Import `createTaskFileIO` from file-io.js
   - Create fileIO instance for each task: `createTaskFileIO(context)`
   - Add `files` to stage context before invoking stage
   - Ensure task folders exist: `fs.mkdir(taskDir, { recursive: true })`

3. **Update context.output writing**
   - Replace legacy `getArtifacts()` usage with `context.files.writeArtifact('output', result)`
   - Remove `raw.artifacts = []` enumeration code
   - Keep `result.task.output = result` for backward compatibility

4. **Update tests**
   - Modify task-runner tests to expect files API in context
   - Update integration tests for new file I/O behavior
   - Ensure backward compatibility tests pass

### Success Criteria

- Task functions receive `context.files` API
- File operations work correctly within stage context
- Legacy `context.output` still works (backward compatibility)
- All task-runner tests pass
- Integration tests demonstrate file I/O working

## Next Step

After completing Step 2, proceed to Step 3 to update demo tasks to use the new file I/O API.
