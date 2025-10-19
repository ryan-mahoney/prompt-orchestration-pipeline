# Task File Read API

## Overview

This API provides secure access to task-scoped files (artifacts, logs, and temporary files) for pipeline jobs. It includes comprehensive validation, path traversal protection, and automatic MIME type detection.

## UI Integration

The frontend uses a single-file viewer component (`TaskFilePane`) that displays exactly one file at a time. The component:

- Takes `jobId`, `taskId`, `type`, and `filename` as props
- Fetches one file via the single-file endpoint
- Displays content based on MIME type (JSON pretty-printed, Markdown rendered, text, or binary placeholder)
- Includes copy functionality for UTF-8 content
- Shows loading states and error handling with retry capability
- **Does not** perform client-side pagination or file listing (parent components handle file selection)

**Usage Pattern**: Parent components (like DAGGrid) maintain file lists and pass a specific `filename` to TaskFilePane for viewing.

## Endpoint

```
GET /api/jobs/:jobId/tasks/:taskId/file?type=artifacts|logs|tmp&filename=<relative>
```

### Parameters

- `jobId` (path): Job identifier
- `taskId` (path): Task identifier
- `type` (query): File type - must be one of `artifacts`, `logs`, or `tmp`
- `filename` (query): Relative file path within the task directory

### Response Format

#### Success (200 OK)

```json
{
  "ok": true,
  "jobId": "test-job-123",
  "taskId": "analysis",
  "type": "artifacts",
  "path": "tasks/analysis/artifacts/output.json",
  "mime": "application/json",
  "size": 1234,
  "mtime": "2024-01-01T10:00:00.000Z",
  "encoding": "utf8",
  "content": "{\"result\": \"success\"}"
}
```

#### Error Responses

- **400 Bad Request** - Missing or invalid parameters

  ```json
  {
    "ok": false,
    "error": "bad_request",
    "message": "type must be one of: artifacts, logs, tmp"
  }
  ```

- **403 Forbidden** - Path traversal or security violation

  ```json
  {
    "ok": false,
    "error": "forbidden",
    "message": "Path traversal not allowed"
  }
  ```

- **404 Not Found** - File or job not found

  ```json
  {
    "ok": false,
    "error": "not_found",
    "message": "File not found"
  }
  ```

- **500 Internal Error** - Server error
  ```json
  {
    "ok": false,
    "error": "internal_error",
    "message": "Failed to read file"
  }
  ```

## Behavior

### File Lookup Order

The endpoint searches for files in this order:

1. `pipeline-data/current/{jobId}/tasks/{taskId}/{type}/{filename}`
2. `pipeline-data/complete/{jobId}/tasks/{taskId}/{type}/{filename}`

### MIME Type Detection

The API automatically detects MIME types based on file extensions:

- **Text files** (UTF-8 encoding): `.txt`, `.log`, `.md`, `.csv`, `.json`, `.xml`, `.yaml`, `.js`, `.py`, etc.
- **Binary files** (Base64 encoding): Images, archives, executables, etc.
- **Unknown extensions**: `application/octet-stream`

### Security Features

- **Path traversal protection**: Rejects `..`, absolute paths, and Windows drive letters
- **Jail validation**: Ensures resolved paths stay within allowed directories
- **Parameter validation**: Strict validation of all input parameters

## Examples

### Read a JSON artifact

```bash
curl "http://localhost:4000/api/jobs/job-123/tasks/analysis/file?type=artifacts&filename=output.json"
```

### Read a log file

```bash
curl "http://localhost:4000/api/jobs/job-123/tasks/analysis/file?type=logs&filename=execution.log"
```

### Read a binary file

```bash
curl "http://localhost:4000/api/jobs/job-123/tasks/analysis/file?type=tmp&filename=data.bin"
```

### Nested directory support

```bash
curl "http://localhost:4000/api/jobs/job-123/tasks/analysis/file?type=artifacts&filename=subdir/report.json"
```

## Error Handling

### Common Errors

1. **Missing parameters**: Ensure both `type` and `filename` are provided
2. **Invalid type**: Use only `artifacts`, `logs`, or `tmp`
3. **Path traversal**: Avoid `..`, absolute paths, or drive letters in filename
4. **File not found**: Check that the file exists in either current or complete directories

### Security Considerations

- All file access is jailed to the specific job/task directory
- Path traversal attempts are blocked and logged
- Only regular files are served (directories, symlinks rejected)
- File content is properly encoded for JSON transport

## Integration Notes

This endpoint is designed to work with the pipeline's file system structure:

```
pipeline-data/
├── current/{jobId}/
│   └── tasks/{taskId}/
│       ├── artifacts/
│       ├── logs/
│       └── tmp/
└── complete/{jobId}/
    └── tasks/{taskId}/
        ├── artifacts/
        ├── logs/
        └── tmp/
```

The API automatically handles the fallback from `current` to `complete` directories, making it suitable for accessing files from both active and completed jobs.
