# Test Validation Notes for Job-Scoped File Reads

## Overview

This document describes the incremental validation approach for testing the job-scoped file read functionality.

## Storage Contract

- **List endpoint** (`GET /api/jobs/:jobId/tasks/:taskId/files`): Reads from task-scoped `tasks/{taskId}/{type}/`
- **File read endpoint** (`GET /api/jobs/:jobId/tasks/:taskId/file`): Reads from job-scoped `files/{type}/`
- **Response path**: Virtual `tasks/{taskId}/{type}/{filename}` regardless of storage location

## Test Seeding Strategy

### For List Tests

- Seed files only in task-scoped location: `tasks/{taskId}/{type}/`
- No need to seed in job-scoped location since list endpoint doesn't read from there

### For File Read Tests

- **Critical**: Seed files in BOTH locations:
  - Task-scoped: `tasks/{taskId}/{type}/{filename}` (for list consistency)
  - Job-scoped: `files/{type}/{filename}` (for actual file content)
- This ensures tests pass for both list and file read operations

### For Integration Tests

- Use dual seeding when tests combine list + content operations
- Example: UI components that list files then fetch content

## Incremental Validation Approach

When running tests after changes to file storage logic:

1. **Run file endpoint tests first**: `npm -s test -- tests/job-file-endpoint.integration.test.js tests/task-file-endpoints.test.js`
2. **Run UI integration tests**: `npm -s test -- tests/TaskFilePane.integration.test.jsx`
3. **Run full suite**: `npm -s test`

This prevents timeouts from hanging tests and isolates issues quickly.

## Common Failure Patterns

### 404 Errors on File Reads

- **Cause**: Files seeded only in task-scoped location but server reads from job-scoped
- **Fix**: Add dual seeding in test setup

### Test Timeouts

- **Cause**: Network or server issues in integration tests
- **Fix**: Run focused tests first, then expand scope

### MIME/Encoding Issues

- **Cause**: Server MIME detection doesn't match test expectations
- **Fix**: Verify MIME map in server code matches test assertions

## Response Envelope Verification

Always verify these fields in file read responses:

- `ok`: boolean success indicator
- `jobId`: job identifier
- `taskId`: task identifier
- `type`: artifacts|logs|tmp
- `path`: virtual `tasks/{taskId}/{type}/{filename}`
- `mime`: detected MIME type
- `size`: file size in bytes
- `mtime`: modification timestamp
- `encoding`: "utf8" or "base64"
- `content`: file content (string or base64)

## Security Validation

Path jail security tests should verify:

- Path traversal attempts are blocked (403)
- Absolute paths are blocked (403)
- Windows drive paths are blocked (403)
- Backslash paths are blocked (403)
- Valid nested paths are allowed (200)
