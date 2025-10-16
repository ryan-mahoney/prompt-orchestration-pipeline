# Step 5 - Migration Script for Existing Demo Data

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

✅ Step 3: Demo Task Updates

- Updated demo/pipeline-config/tasks/analysis/index.js to use new file I/O API
- Added context.files.writeLog calls for ingestion and integration stages
- Write raw-research.json artifact with metadata using writeArtifact
- Create analysis-output.json and analysis-summary.txt artifacts
- Demonstrate default modes (append for logs, replace for artifacts)
- Created comprehensive integration test for file I/O functionality (5/5 passing)

✅ UI Schema Migration (Prerequisite)

- Updated job-adapter to prefer files.\* over legacy artifacts
- Modified status-transformer to handle new files.\* schema
- Updated JobDetail component to render files.\* instead of task.artifacts
- Updated tests to expect new files.\* schema
- All UI tests passing with new schema
- Updated storage.md and tasks-data-shape.md documentation

✅ Step 4: API Endpoint Updates

- Updated job-detail endpoint to return files.\* schema instead of legacy artifacts
- Removed legacy artifacts field from API responses completely
- Added comprehensive test to verify new schema structure
- Ensured backward compatibility is properly broken as intended
- All job-detail API tests passing (5/5)

## Current Phase Objective

Create migration script to transform existing demo data from legacy artifacts format to new files.\* schema structure.

## Implementation Requirements

### Migration Script

**File to create:** `scripts/migrate-demo-files.js`

**Functionality:**

1. **Scan existing demo jobs** in `demo/pipeline-data/{current,complete,pending}/`
2. **Identify legacy artifacts** in tasks-status.json files
3. **Create task subdirectories** with `artifacts/`, `logs/`, `tmp/` folders
4. **Move legacy artifact files** to appropriate task subdirectories
5. **Update tasks-status.json** to use new files.\* schema
6. **Handle edge cases** (missing files, conflicting names, etc.)

**Script API:**

```javascript
// Usage: node scripts/migrate-demo-files.js [--dry-run] [--data-dir=/path/to/data]
const { migrateDemoFiles } = await import("./scripts/migrate-demo-files.js");
await migrateDemoFiles({ dataDir: "demo", dryRun: false });
```

### Migration Logic

**For each job:**

1. Read `tasks-status.json`
2. For each task with legacy artifacts:
   - Create `tasks/{taskName}/artifacts/` directory
   - Move artifact files from job root to task subdirectory
   - Update task.files.artifacts array with moved file names
3. For each task:
   - Ensure `files` object exists with all three arrays (artifacts, logs, tmp)
   - Initialize empty arrays if not present
4. Write updated `tasks-status.json`

**File Movement Strategy:**

- Legacy artifacts in job root → `tasks/{taskName}/artifacts/{filename}`
- Preserve original filenames
- Handle conflicts by appending `_1`, `_2`, etc.
- Create parent directories as needed

### Test Requirements

**Test file:** `tests/migrate-demo-files.test.js`

**Test cases:**

1. **Dry run mode**: Report changes without executing
2. **Simple migration**: Single job with legacy artifacts
3. **Multiple tasks**: Job with several tasks having artifacts
4. **Edge cases**: Missing files, empty arrays, malformed data
5. **Idempotency**: Running script twice should be safe
6. **Validation**: Output schema is correct

### Success Criteria

- Migration script transforms all existing demo data correctly
- All legacy artifact files are moved to proper task subdirectories
- tasks-status.json files use new files.\* schema
- Migration is reversible (backup strategy)
- All tests for migration script pass
- Demo pipeline works with migrated data

## Next Step

After completing Step 5, proceed to Step 6 to run full test suite validation.
