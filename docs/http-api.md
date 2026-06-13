# HTTP/SSE Protocol Reference

This document is the authoritative reference for the Prompt Orchestration Pipeline HTTP API and Server-Sent Events stream. A consumer should be able to build a client from this document alone.

## Transport

- **Protocol**: HTTP/1.1 + Server-Sent Events (SSE). The API does not use WebSocket.
- **Default port**: `4000` (configurable via `--port`).
- **Bind address**: `127.0.0.1` (loopback only). The server does not listen on non-loopback interfaces.
- **Trust model**: localhost. The `Host` header must resolve to a loopback address (`localhost`, `127.0.0.1`, or `[::1]`). Requests with a non-loopback `Host` are rejected with `403 forbidden_host`.
- **CORS**: Opt-in via `--cors-origins <comma-separated-origins>` and `--cors-allow-null-origin`. When no origins are configured, no `Access-Control-*` headers are emitted. Cross-origin mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/*` are rejected before dispatch when the origin is not allowed.
- **Content type**: All JSON responses use `Content-Type: application/json`. SSE streams use `Content-Type: text/event-stream`.

## Response Envelope

Every JSON response uses the shape:

```json
{ "ok": true, "data": { ... } }
```

or on error:

```json
{ "ok": false, "code": "<error_code>", "message": "<human-readable message>" }
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `job_not_found` / `JOB_NOT_FOUND` / `NOT_FOUND` | 404 | Job or resource does not exist |
| `job_running` / `JOB_RUNNING` | 409 | Job is currently executing |
| `conflict` / `BAD_REQUEST` (409) | 409 | Action conflicts with current state |
| `spawn_failed` / `SPAWN_FAILED` | 500 | Failed to spawn a pipeline runner |
| `task_not_found` / `TASK_NOT_FOUND` | 404 | Task does not exist in the job |
| `task_not_pending` / `TASK_NOT_PENDING` | 422 | Task is not in a pending state |
| `dependencies_not_satisfied` / `DEPENDENCIES_NOT_SATISFIED` | 412 | Task dependencies are incomplete |
| `unsupported_lifecycle` / `UNSUPPORTED_LIFECYCLE` | 501 | Lifecycle action not supported |
| `concurrency_limit_reached` | 409 | Max concurrent job slots occupied |
| `unknown_error` | 500 | Unspecified server error |
| `network_error` | — | Client-side network failure (never from server) |
| `malformed_response` | — | Client-side parse failure (never from server) |
| `forbidden_host` | 403 | `Host` header is not loopback |
| `forbidden_origin` | 403 | Cross-origin mutation rejected |
| `status_unavailable` | 500 | Job status file unreadable |
| `no_pending_gate` | 409 | Job has no pending gate decision |
| `FS_ERROR` | 500 | Filesystem operation failed |
| `BAD_REQUEST` | 400 | Malformed request body |
| `NOT_FOUND` | 404 | Route or resource not found |

## Routes

All routes are prefixed with `/api`. The server also serves a bundled SPA from `/` for non-API paths.

### Jobs

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/jobs` | — | `{ ok, data: JobSummary[] }` |
| `GET` | `/api/jobs/:jobId` | — | `{ ok, data: JobDetail }` |
| `POST` | `/api/jobs/:jobId/gate` | `{ action: "approve" \| "reject", note?: string }` | `{ ok, jobId, action, spawned }` (202) |
| `POST` | `/api/jobs/:jobId/restart` | `{ fromTask?: string, singleTask?: boolean, continueAfter?: boolean, options?: { clearTokenUsage?: boolean } }` | `{ ok, message? }` |
| `POST` | `/api/jobs/:jobId/stop` | — | `{ ok, message? }` |
| `POST` | `/api/jobs/:jobId/rescan` | — | `{ ok, message? }` |
| `POST` | `/api/jobs/:jobId/tasks/:taskId/start` | — | `{ ok, message? }` |

### Job Files

| Method | Path | Query Params | Response |
|--------|------|-------------|----------|
| `GET` | `/api/jobs/:jobId/tasks/:taskId/files` | `?type=artifacts\|logs\|tmp` (default: `artifacts`) | `{ ok, data: string[] }` |
| `GET` | `/api/jobs/:jobId/tasks/:taskId/file` | `?type=...&filename=...` | `{ ok, data: string, mime: string }` |

### Pipelines

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/pipelines` | — | `{ ok, data: { slug, name, description }[] }` |
| `GET` | `/api/pipelines/:slug` | — | `{ ok, data: PipelineDetail }` |
| `POST` | `/api/pipelines` | `{ name: string, description?: string }` | `{ ok, data: { slug, name, description } }` (201) |
| `GET` | `/api/pipelines/:slug/artifacts` | — | `{ ok, data: Artifact[] }` |
| `GET` | `/api/pipelines/:slug/tasks/:taskId/analysis` | — | `{ ok, data: AnalysisResult }` |
| `GET` | `/api/pipelines/:slug/schemas/:filename` | — | `{ ok, data: string }` (schema content) |

### Analysis and Task Planning

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/pipelines/:slug/analyze` | — | SSE stream: `started` → `complete` |
| `POST` | `/api/ai/task-plan` | — | SSE stream: `started` → `complete` |

These endpoints return `Content-Type: text/event-stream` (route-local SSE). See [Route-Local SSE Streams](#route-local-sse-streams).

### Tasks

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/tasks/create` | `{ slug: string, taskId: string, content: string }` | `{ ok, data: { slug, taskId } }` (201) |

### Upload

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `POST` | `/api/upload/seed` | JSON seed object or `multipart/form-data` (with optional `.zip`) | `{ ok, data: { jobId } }` (201) |

### System

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/state` | `{ ok, data: StateSnapshot }` |
| `GET` | `/api/meta` | `{ ok, data: { name, version, protocolVersion } }` |
| `GET` | `/api/concurrency` | `{ ok, data: ConcurrencyStatus }` |

#### `/api/meta` Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Package name from `package.json` |
| `version` | `string` | Package version from `package.json` |
| `protocolVersion` | `number` | Protocol version integer; bumped only on breaking changes (see [Protocol Versioning](#protocol-versioning)) |

#### `/api/concurrency` Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `limit` | `number` | Max concurrent jobs |
| `runningCount` | `number` | Currently running jobs |
| `availableSlots` | `number` | Remaining slot capacity |
| `queuedCount` | `number` | Queued jobs waiting for a slot |
| `activeJobs` | `Array<{ jobId, pid, acquiredAt, source }>` | Jobs occupying slots |
| `queuedJobs` | `Array<{ jobId, queuedAt, name, pipeline }>` | Jobs waiting in queue |
| `staleSlots` | `Array<{ jobId, reason }>` | Slots that appear stale |

### SSE Stream (Global)

| Method | Path | Query Params | Response |
|--------|------|-------------|----------|
| `GET` | `/api/events` | `?jobId=<id>` (optional filter) | SSE stream |
| `GET` | `/api/sse` | `?jobId=<id>` (optional filter) | SSE stream (legacy alias) |

## SSE Event Stream

### Connection

Connect to `GET /api/events` (or the legacy `GET /api/sse`). The server responds with:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

On connect, the server sends an initial comment: `: connected\n\n`.

### Keep-Alive

The server sends a keep-alive comment every **8 seconds**:

```
: keep-alive
```

Clients should treat a gap longer than the keep-alive interval as a potential disconnect.

### Event Types

| Event | Data Shape | Description |
|-------|-----------|-------------|
| `state:change` | `{ jobId, changeType, ... }` | A job's state has changed |
| `state:summary` | `{ changeCount }` | Summary of accumulated state changes |
| `job:created` | `JobSummary` | A new job was detected |
| `job:updated` | `JobSummary` | An existing job was updated |
| `heartbeat` | `{ ok, timestamp }` | Application-level heartbeat (distinct from the keep-alive comment) |

### Job Filtering

Pass `?jobId=<id>` to receive only events whose data contains a matching `jobId` field. Without the parameter, all events are received.

### SSE Framing

Each event follows the standard SSE format:

```
event: <type>
data: <JSON>

```

Events are separated by a blank line (`\n\n`).

### Route-Local SSE Streams

Two endpoints return route-local SSE streams (not from the global `/api/events` stream):

**`POST /api/pipelines/:slug/analyze`**

```
event: started
data: {"slug":"<slug>"}

event: complete
data: {"slug":"<slug>"}

```

Returns `409` if an analysis lock is already held for the pipeline.

**`POST /api/ai/task-plan`**

```
event: started
data: {"ok":true,"message":"task planning is not implemented in TypeScript yet"}

event: complete
data: {"ok":true}

```

## Client Robustness Rules

1. **Ignore unknown JSON fields.** When parsing a JSON response, ignore any fields not documented here. New fields may be added in minor versions.
2. **Ignore unknown SSE event types.** When processing the SSE stream, ignore any event type not documented here. New event types may be added in minor versions.

## SSE Event Evolution

- **Adding a new event type** is a **minor** change (given the robustness rule above).
- **Changing an existing event's payload shape** (removing or renaming a field, changing a field's type) is a **breaking** change.

## Protocol Versioning

The `protocolVersion` integer returned by `GET /api/meta` is the protocol's semver indicator:

- It is **bumped** only when `docs/http-api.md` is updated for a breaking protocol change.
- It is **not** bumped for additive changes (new routes, new event types, new response fields) because the robustness rules make those backward-compatible.

The version is defined in `src/ui/server/endpoints/meta-endpoint.ts` as `PROTOCOL_VERSION`.
