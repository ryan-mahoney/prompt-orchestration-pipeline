# SpecOps Analysis: `ui/server`

## 1. Purpose & Responsibilities

The `ui/server` module is the web-facing subsystem of the Prompt Orchestration Pipeline (POP). It provides an HTTP server that exposes a REST API for managing pipeline jobs, tasks, and pipeline definitions, a Server-Sent Events (SSE) real-time notification layer, and a static asset server for the single-page application (SPA) frontend.

**Responsibilities:**

- **HTTP server lifecycle:** Creating, starting, and gracefully shutting down the Node.js HTTP server, including startup error handling, timeout protection, and port conflict detection.
- **Express application assembly:** Building and configuring the Express application with middleware (JSON parsing, CORS, URL-encoded body parsing) and mounting all API route handlers.
- **REST API surface:** Exposing endpoints for job listing, job detail, job control (restart, stop, rescan, task start), pipeline listing, pipeline creation, pipeline type detail, pipeline analysis, pipeline artifacts, task file access, task analysis, task creation/saving, seed upload, schema files, and application state.
- **Real-time event broadcasting:** Managing SSE client connections, broadcasting incremental state change events and heartbeats, and supporting per-job event filtering.
- **SSE enhancement:** Debouncing file-system change events per job, reading updated job data, transforming it to the canonical API schema, and broadcasting `job:created` / `job:updated` events.
- **File system watching:** Integrating with the watcher subsystem to detect changes in pipeline data directories and trigger state updates and SSE broadcasts.
- **Static asset serving:** Serving the built SPA in three modes: Vite dev server (HMR), embedded assets (compiled binary), or static filesystem dist directory.
- **Safe file I/O:** Providing validated, retryable JSON file reading with size limits, BOM handling, and structured error envelopes.
- **Job scanning and reading:** Discovering job directories across lifecycle locations (current, complete, pending, rejected), reading `tasks-status.json` with lock awareness, and indexing/caching jobs.
- **Configuration bridging:** Providing a unified configuration layer (constants, path resolution, validation helpers, error response factories) that works across both Node.js server modules and universal browser-compatible modules.
- **Zip extraction:** Parsing uploaded zip files to extract seed data and associated artifacts.
- **Utility services:** Slug generation, MIME type detection, HTTP response helpers, multipart form parsing, and path security validation.

**Boundaries:**

- Does NOT own the core orchestrator or pipeline runner logic; it delegates job execution by spawning detached child processes via `self-reexec`.
- Does NOT own the watcher implementation itself; it imports `start`/`stop` from the watcher module.
- Does NOT own the state module; it calls `state.recordChange()` and `state.getState()` but state management lives in the `ui/state` module.
- Does NOT own task analysis logic; it delegates to `task-analysis/` modules for static analysis and schema deduction.
- Does NOT own LLM provider logic; it delegates to `llm/index.js` for streaming chat.
- Does NOT serve as a database or persistent store; it reads/writes JSON files on disk.

**Pattern:** This module acts as an **HTTP gateway / adapter** that translates HTTP requests into calls to domain-specific modules and formats their results as JSON API responses. The SSE layer acts as an **event broadcaster / observer hub**.

---

## 2. Public Interface

### 2.1 Server Lifecycle (`server.js`)

| Export | Purpose | Parameters | Return | Errors |
|--------|---------|------------|--------|--------|
| `createServer(serverDataDir?)` | Creates an HTTP server backed by the Express app | `serverDataDir`: string, base data directory (defaults to `PO_ROOT` or `cwd()`) | `Promise<http.Server>` | Propagates errors from `buildExpressApp` |
| `startServer({ dataDir, port? })` | Full server startup: loads env, initializes config-bridge paths, optionally starts Vite, creates server, listens on port, starts watcher and heartbeat | `dataDir`: string (required); `port`: number (optional, defaults to `PORT` env or `4000`) | `Promise<{ url: string, close: () => Promise<void> }>` — `url` is the base URL; `close` tears down all resources | Throws on port conflict (`EADDRINUSE`), startup timeout (5s), or missing `PO_ROOT` in non-test mode |
| `initializeWatcher()` | Starts the file watcher on pipeline data directories | None | `void` | Throws if `PO_ROOT` is missing and not in test mode |
| `broadcastStateUpdate` | Re-exported from `sse-broadcast.js` | (see below) | | |
| `sseRegistry` | Re-exported singleton SSE registry | | | |
| `state` | Re-exported `state` module | | | |

When run as the main module (not in compiled binary mode), `startServer` is called automatically.

### 2.2 Express App (`express-app.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `buildExpressApp({ dataDir, viteServer? })` | Constructs a fully configured Express application with all middleware and routes | `dataDir`: string; `viteServer`: Vite dev server instance or null | `Promise<express.Application>` |

### 2.3 SSE Registry (`sse.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `createSSERegistry({ heartbeatMs?, sendInitialPing? })` | Factory: creates a new SSE registry instance | `heartbeatMs`: number (default 15000); `sendInitialPing`: boolean (default false) | `{ addClient, removeClient, broadcast, getClientCount, closeAll }` |
| `sseRegistry` | Singleton instance with `heartbeatMs=15000, sendInitialPing=true` | | |

**`addClient(res, metadata?)`** — Registers a client response object. Optionally writes SSE headers (`writeHead`) and initial ping (`: connected\n\n`). Attaches `close` event listener for auto-removal. Starts heartbeat timer on first client.

**`removeClient(res)`** — Finds and removes a client by response reference. Calls `res.end()`. Stops heartbeat when no clients remain.

**`broadcast(arg1, arg2?)`** — Flexible broadcast supporting three call signatures:
- `broadcast({ type, data })` — typed event
- `broadcast("eventName", data)` — typed event (string first arg)
- `broadcast(data)` — untyped `message` event

Serializes data as JSON. Applies **jobId filtering**: if the event data contains a `jobId` and a client registered with a `jobId`, the event is only sent to matching clients. Dead clients are cleaned up automatically.

**`getClientCount()`** — Returns number of connected clients.

**`closeAll()`** — Ends all client connections, clears the client set, stops heartbeat.

### 2.4 SSE Broadcast (`sse-broadcast.js`)

| Export | Purpose |
|--------|---------|
| `broadcastStateUpdate(currentState)` | Broadcasts incremental SSE events from state changes |

Behavior: extracts `recentChanges` from the state object, prioritizes changes to `tasks-status.json`, decorates changes with `jobId` and `lifecycle` extracted from the file path, then broadcasts either a `state:change` event (with the prioritized change) or a `state:summary` event (with `changeCount`). Never broadcasts full application state over SSE.

### 2.5 SSE Enhancer (`sse-enhancer.js`)

| Export | Purpose |
|--------|---------|
| `createSSEEnhancer({ readJobFn, sseRegistry, debounceMs? })` | Factory: creates an enhancer that debounces job change events and broadcasts enriched job data |
| `sseEnhancer` | Singleton instance (may be null if dependencies unavailable) |

**`handleJobChange({ jobId, category?, filePath? })`** — Debounces per `jobId` (default 200ms). After debounce, reads job via `readJobFn`, transforms through `transformJobStatus` then `transformJobListForAPI`, and broadcasts `job:created` (first time) or `job:updated` (subsequent).

**`getPendingCount()`** — Returns count of pending debounced timers.

**`cleanup()`** — Clears all pending timers.

### 2.6 File Reader (`file-reader.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `validateFilePath(filePath)` | Validates file exists, is a regular file, and within size limits | `filePath`: string | `Promise<{ ok: true, path, size, modified } \| ErrorEnvelope>` |
| `readJSONFile(filePath)` | Reads and parses a JSON file with validation and BOM handling | `filePath`: string | `Promise<{ ok: true, data, path } \| ErrorEnvelope>` |
| `readFileWithRetry(filePath, options?)` | Reads JSON with retries for transient errors | `filePath`: string; `options.maxAttempts` (default 3, max 5); `options.delayMs` (default varies by env, max 50ms) | `Promise<{ ok: true, data, path } \| ErrorEnvelope>` |
| `readMultipleJSONFiles(filePaths)` | Reads multiple JSON files in parallel | `filePaths`: string[] | `Promise<Array<Result>>` |
| `getFileReadingStats(filePaths, results)` | Computes read statistics | | `{ totalFiles, successCount, errorCount, successRate, errorTypes }` |

### 2.7 Job Reader (`job-reader.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `readJob(jobId)` | Reads a job's `tasks-status.json` with lock-awareness and location precedence (`current` then `complete`) | `jobId`: string | `Promise<{ ok: true, data, location, path } \| ErrorEnvelope>` |
| `readMultipleJobs(jobIds)` | Reads multiple jobs in parallel | `jobIds`: string[] | `Promise<Array<Result>>` |
| `getJobReadingStats(jobIds, results)` | Computes job read statistics | | `{ totalJobs, successCount, errorCount, successRate, errorTypes, locations }` |

### 2.8 Job Index (`job-index.js`)

| Export | Purpose |
|--------|---------|
| `JobIndex` (class) | In-memory job cache with methods: `refresh()`, `getJob(id)`, `getAllJobs()`, `getJobsByLocation(loc)`, `hasJob(id)`, `getJobCount()`, `getStats()`, `clear()`, `updateJob(id, data, location, path)`, `removeJob(id)` |
| `createJobIndex()` | Factory: creates a new `JobIndex` instance |
| `getJobIndex()` | Returns the singleton `JobIndex` |
| `resetJobIndex()` | Resets the singleton (for testing) |

### 2.9 Job Scanner (`job-scanner.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `listJobs(location)` | Lists job directory names for a lifecycle location | `location`: `"current"` \| `"complete"` \| `"pending"` \| `"rejected"` | `Promise<string[]>` — empty on invalid location or errors |
| `listAllJobs()` | Lists jobs from both `current` and `complete` | None | `Promise<{ current: string[], complete: string[] }>` |
| `getJobDirectoryStats(location)` | Returns stats about a job directory | `location`: string | `Promise<{ location, exists, jobCount, totalEntries, error? }>` |

### 2.10 Config Bridge (Universal) (`config-bridge.js`)

| Export | Purpose |
|--------|---------|
| `Constants` | Global constants: `JOB_ID_REGEX`, `TASK_STATES`, `JOB_LOCATIONS`, `STATUS_ORDER`, `FILE_LIMITS`, `RETRY_CONFIG`, `SSE_CONFIG`, `ERROR_CODES` |
| `validateJobId(jobId)` | Tests job ID against `JOB_ID_REGEX` |
| `validateTaskState(state)` | Tests state against valid task states |
| `getStatusPriority(status)` | Returns sort priority for a job status |
| `determineJobStatus(tasks)` | Derives aggregate job status from task states |
| `createErrorResponse(code, message, path?)` | Creates `{ ok: false, code, message, path? }` envelope |

### 2.11 Config Bridge (Node) (`config-bridge.node.js`)

Extends the universal config bridge with Node-specific functionality:

| Export | Purpose |
|--------|---------|
| `Constants` | Same as universal, except `RETRY_CONFIG.DELAY_MS` is 10ms in test, 1000ms otherwise |
| `resolvePipelinePaths(root?)` | Resolves `current`/`complete`/`pending`/`rejected` directory paths |
| `getJobPath(jobId, location?)` | Returns absolute path to a job directory |
| `getTasksStatusPath(jobId, location?)` | Returns path to `tasks-status.json` |
| `getSeedPath(jobId, location?)` | Returns path to `seed.json` |
| `getTaskPath(jobId, taskName, location?)` | Returns path to a task directory |
| `isLocked(jobDir)` | Checks for `.lock` files in job directory (one level deep) |
| `initPATHS(root)` | Initializes cached path resolution |
| `resetPATHS()` | Clears cached paths |
| `getPATHS(root?)` | Returns cached paths, optionally re-initializing |
| `PATHS` | Eagerly resolved path object (convenience export) |
| Plus all universal exports | `validateJobId`, `validateTaskState`, `getStatusPriority`, `determineJobStatus`, `createErrorResponse` |

### 2.12 HTTP Utilities (`utils/http-utils.js`)

| Export | Purpose | Parameters |
|--------|---------|------------|
| `sendJson(res, code, obj)` | Sends JSON response with `Content-Type` and `Connection: close` headers | `res`: response; `code`: HTTP status; `obj`: body |
| `readRawBody(req, maxBytes?)` | Reads raw request body with 2MB size guard | `req`: request; `maxBytes`: number (default 2MB) |
| `parseMultipartFormData(req)` | Parses multipart/form-data, extracts file content as Buffer | `req`: request |

### 2.13 MIME Types (`utils/mime-types.js`)

| Export | Purpose |
|--------|---------|
| `MIME_MAP` | Extension-to-MIME-type mapping object covering text, code, web, data, image, audio, video, archive, font, and miscellaneous types |
| `getMimeType(filename)` | Returns MIME type for a filename (defaults to `application/octet-stream`) |
| `isTextMime(mime)` | Returns true if MIME type should be treated as text content |

### 2.14 Slug Utilities (`utils/slug.js`)

| Export | Purpose | Parameters |
|--------|---------|------------|
| `generateSlug(name)` | Generates URL-friendly kebab-case slug (max 47 chars) | `name`: string |
| `ensureUniqueSlug(baseSlug, existingSlugs)` | Appends numeric suffix if needed to ensure uniqueness | `baseSlug`: string; `existingSlugs`: Set |

### 2.15 Embedded Assets (`embedded-assets.js`)

| Export | Purpose |
|--------|---------|
| `embeddedAssets` | Auto-generated map of URL paths to `{ path, mime }` objects for compiled binary asset serving |

### 2.16 Zip Utilities (`zip-utils.js`)

| Export | Purpose | Parameters | Return |
|--------|---------|------------|--------|
| `extractSeedZip(zipBuffer)` | Extracts seed.json and artifact files from a zip | `zipBuffer`: Buffer or Uint8Array | `Promise<{ seedObject, artifacts: Array<{ filename, content }> }>` |

### 2.17 API Endpoints

#### Job Endpoints (`endpoints/job-endpoints.js`)

| Export | Purpose |
|--------|---------|
| `handleJobList()` | Core logic: scans current and complete jobs, reads, transforms, aggregates, sorts, returns list |
| `handleJobDetail(jobId)` | Core logic: validates, reads, transforms single job detail with optional pipeline config |
| `handleJobListRequest(req, res)` | HTTP wrapper for `handleJobList` |
| `handleJobDetailRequest(req, res, jobId)` | HTTP wrapper for `handleJobDetail` |
| `getEndpointStats(jobListResponses, jobDetailResponses)` | Computes endpoint statistics for test assertions |

#### Job Control Endpoints (`endpoints/job-control-endpoints.js`)

| Export | Purpose |
|--------|---------|
| `handleJobRescan(req, res, jobId, dataDir, sendJson)` | Synchronizes job's `pipeline.json` with source, updates `tasks-status.json` |
| `handleJobRestart(req, res, jobId, dataDir, sendJson)` | Resets job state (clean-slate, partial, or single-task), spawns detached pipeline runner |
| `handleJobStop(req, res, jobId, dataDir, sendJson)` | Reads PID, sends SIGTERM/SIGKILL, resets running task, normalizes root fields |
| `handleTaskStart(req, res, jobId, taskId, dataDir, sendJson)` | Validates dependencies, resets task if needed, spawns detached runner for single task |
| Guard function exports | `isRestartInProgress`, `beginRestart`, `endRestart`, `isStartInProgress`, `beginStart`, `endStart`, `isStopInProgress`, `beginStop`, `endStop` |
| Helper function exports | `resolveJobLifecycle(dataDir, jobId)` — resolves job lifecycle location (`"current"`, `"complete"`, `"rejected"`, or `null`); not a guard function |

#### Pipeline Endpoints (`endpoints/pipelines-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handlePipelinesRequest()` | Core logic: reads `registry.json`, returns pipeline slug/name/description list |
| `handlePipelinesHttpRequest(req, res)` | HTTP wrapper |

#### Pipeline Type Detail (`endpoints/pipeline-type-detail-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handlePipelineTypeDetail(slug)` | Core logic: reads `pipeline.json`, returns tasks with `{ id, title, status: "definition" }` |
| `handlePipelineTypeDetailRequest(req, res)` | HTTP wrapper |

#### Pipeline Analysis (`endpoints/pipeline-analysis-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handlePipelineAnalysis(req, res)` | Analyzes all tasks via static analysis, deduces artifact schemas via LLM, streams progress via SSE, enforces analysis lock |

#### Pipeline Artifacts (`endpoints/pipeline-artifacts-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handlePipelineArtifacts(req, res)` | Aggregates and de-duplicates artifact writes from all `*.analysis.json` files |

#### Create Pipeline (`endpoints/create-pipeline-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleCreatePipeline(req, res)` | Validates name/description, generates unique slug, creates directory structure and starter files, atomically updates `registry.json` |

#### File Endpoints (`endpoints/file-endpoints.js`)

| Export | Purpose |
|--------|---------|
| `validateFilePath(filename)` | Security validation: rejects path traversal, absolute paths, backslashes, tilde paths, empty filenames |
| `handleTaskFileListRequest(req, res, params)` | Lists files in a task's artifacts/logs/tmp directory |
| `handleTaskFileRequest(req, res, params)` | Serves individual task file content (text as UTF-8, binary as base64) |

#### Upload Endpoints (`endpoints/upload-endpoints.js`)

| Export | Purpose |
|--------|---------|
| `handleSeedUpload(req, res)` | Handles seed file upload (JSON or zip); in test mode writes directly, in production delegates to `submitJobWithValidation` |
| `normalizeSeedUpload({ req, contentTypeHeader })` | Normalizes upload format: JSON body, multipart JSON file, or multipart zip |
| `handleSeedUploadDirect(seedObject, dataDir, uploadArtifacts?)` | Direct seed processing for test: validates, generates job ID, writes seed/metadata/pipeline files, initializes artifacts |

#### Task Creation (`endpoints/task-creation-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleTaskPlan(req, res)` | Streams LLM-powered task planning via SSE; enriches prompt with pipeline guidelines, @mention-based schema context |

#### Task Save (`endpoints/task-save-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleTaskSave(req, res)` | Saves task file to pipeline directory, runs LLM-based code review/correction, updates task registry `index.js` |

#### Task Analysis (`endpoints/task-analysis-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleTaskAnalysisRequest(req, res)` | Returns cached task analysis data from `*.analysis.json` files |

#### Schema File (`endpoints/schema-file-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleSchemaFileRequest(req, res)` | Serves schema or sample JSON files for pipeline tasks |

#### State Endpoint (`endpoints/state-endpoint.js`)

| Export | Purpose |
|--------|---------|
| `handleApiState(req, res)` | Returns in-memory state if available, otherwise builds filesystem-backed snapshot |

#### SSE Endpoints (`endpoints/sse-endpoints.js`)

| Export | Purpose |
|--------|---------|
| `handleSseEvents(req, res, searchParams)` | Handles SSE connection setup with headers, heartbeat, client registration, disconnect cleanup |
| `handleApiState(req, res)` | Duplicate of state endpoint (appears in both `sse-endpoints.js` and `state-endpoint.js`) |
| `broadcastStateUpdate(currentState)` | Duplicate of `sse-broadcast.js` function |

---

## 3. Data Models & Structures

### 3.1 SSE Client Object

| Field | Type | Description |
|-------|------|-------------|
| `res` | `http.ServerResponse` or mock `{ write, end?, on? }` | The response stream for writing SSE events |
| `jobId` | `string?` | Optional job ID for event filtering |

- **Lifecycle:** Created when a client connects to `/api/events` or `/api/sse`; destroyed when the client disconnects or the server calls `closeAll()`.
- **Ownership:** Owned by the SSE registry's internal `Set<client>`.

### 3.2 Error Envelope

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `false` | Always false for errors |
| `code` | `string` | Error code from `Constants.ERROR_CODES` |
| `message` | `string` | Human-readable error description |
| `path` | `string?` | Optional file path associated with the error |

- **Lifecycle:** Created on-demand, not persisted.
- **Ownership:** Factory method in both `config-bridge.js` and `config-bridge.node.js`.

### 3.3 Job Read Result

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `true` | Success flag |
| `data` | `Object` | Parsed `tasks-status.json` content |
| `location` | `string` | Lifecycle location where job was found (`"current"` or `"complete"`) |
| `path` | `string` | Absolute file path to `tasks-status.json` |

### 3.4 File Read Result

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `true` | Success flag |
| `data` | `Object` | Parsed JSON content |
| `path` | `string` | File path |

### 3.5 File Validation Result

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `true` | Success flag |
| `path` | `string` | Validated file path |
| `size` | `number` | File size in bytes |
| `modified` | `Date` | Last modification time |

### 3.6 Job Index Entry (in `JobIndex.jobsById` Map)

Transformed job object augmented with:

| Field | Type | Description |
|-------|------|-------------|
| `location` | `string` | Lifecycle location |
| `path` | `string` | Path to tasks-status.json |
| (plus all fields from `transformJobStatus`) | | |

### 3.7 File Reading Stats

| Field | Type | Description |
|-------|------|-------------|
| `totalFiles` | `number` | Total files attempted |
| `successCount` | `number` | Successfully read |
| `errorCount` | `number` | Failed reads |
| `successRate` | `number` | Percentage (0-100, 2 decimal places) |
| `errorTypes` | `Object` | Map of error code to count |

### 3.8 Job Directory Stats

| Field | Type | Description |
|-------|------|-------------|
| `location` | `string` | Lifecycle location |
| `exists` | `boolean` | Whether directory exists |
| `jobCount` | `number` | Number of valid job directories |
| `totalEntries` | `number` | Total directory entries |
| `error` | `string?` | Error message if any |

### 3.9 Embedded Asset Entry

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | Bun file reference to the embedded asset |
| `mime` | `string` | MIME type for the response |

### 3.10 Seed Upload Result

| Field | Type | Description |
|-------|------|-------------|
| `seedObject` | `Object` | Parsed seed JSON |
| `artifacts` | `Array<{ filename: string, content: Buffer }>` | Extracted files |

### 3.11 Constants Object

| Key | Value | Description |
|-----|-------|-------------|
| `JOB_ID_REGEX` | `/^[A-Za-z0-9-_]+$/` | Valid job ID pattern |
| `TASK_STATES` | Array from `TaskState` enum | Valid task states |
| `JOB_LOCATIONS` | Array from `JobLocation` enum | Valid lifecycle locations |
| `STATUS_ORDER` | `[RUNNING, FAILED, PENDING, COMPLETE]` | Sort priority |
| `FILE_LIMITS.MAX_FILE_SIZE` | `5 * 1024 * 1024` (5MB) | Maximum readable file size |
| `RETRY_CONFIG.MAX_ATTEMPTS` | `3` | Default retry count |
| `RETRY_CONFIG.DELAY_MS` | `1000` (or `10` in test) | Delay between retries |
| `SSE_CONFIG.DEBOUNCE_MS` | `200` | SSE debounce interval |
| `ERROR_CODES` | `{ NOT_FOUND, INVALID_JSON, FS_ERROR, JOB_NOT_FOUND, BAD_REQUEST }` | Structured error codes |

---

## 4. Behavioral Contracts

### Preconditions

- **`startServer`**: `PO_ROOT` environment variable must be set in non-test environments. The `dataDir` parameter must point to a valid directory.
- **`initializeWatcher`**: `PO_ROOT` must be set in non-test environments.
- **`readJob`**: Job ID must match `JOB_ID_REGEX`.
- **`readFileWithRetry`**: File path must be a string.
- **`createSSEEnhancer`**: Both `readJobFn` and `sseRegistry` are required.
- **Job control endpoints**: Valid `jobId` string, non-empty. Job must exist in a lifecycle directory.
- **`handleTaskStart`**: All upstream tasks in the pipeline DAG must be in `done` state before starting a task.

### Postconditions

- **`startServer`** returns a `{ url, close }` object. The `close` function, when awaited, guarantees: heartbeat timer cleared, watcher stopped, all SSE clients disconnected, Vite dev server closed (if running), HTTP server closed.
- **`broadcastStateUpdate`** always broadcasts exactly one SSE event: either `state:change` or `state:summary`. It never throws (defensive try/catch at two levels).
- **SSE `broadcast`** cleans up dead clients on every invocation.
- **`readJob`** searches `current` before `complete`. If found, returns the data from the first matching location.
- **`readFileWithRetry`** returns immediately for `NOT_FOUND` errors (no retries). Retries on `INVALID_JSON` and `FS_ERROR`.
- **`handleJobRestart`** moves the job to `current` lifecycle if not already there before resetting and spawning.
- **`handleJobStop`** attempts SIGTERM first, waits 1500ms, escalates to SIGKILL if process still alive.
- **`handleCreatePipeline`** updates `registry.json` atomically via temp file + rename.

### Invariants

- The SSE registry heartbeat timer runs only when at least one client is connected.
- The SSE registry never holds references to disconnected clients (dead clients are cleaned on every broadcast and on `close` events).
- File reads never exceed 5MB (`MAX_FILE_SIZE`).
- Retry attempts are capped at 5, delay capped at 50ms, regardless of caller-provided options.
- Job IDs in the system always match `^[A-Za-z0-9-_]+$`.
- Path security: file endpoints reject path traversal (`..`), absolute paths, backslashes, tilde paths.

### Ordering Guarantees

- Job listing reads `current` jobs before `complete` jobs. Jobs already found in `current` are not re-read from `complete`.
- SSE broadcasts maintain insertion order of clients (iteration order of `Set`).
- `broadcastStateUpdate` prioritizes `tasks-status.json` changes over other file changes.

### Concurrency Behavior

- **Job control guards**: `handleJobRestart`, `handleJobStop`, and `handleTaskStart` use in-memory `Set` guards (`restartingJobs`, `stoppingJobs`, `startingJobs`) to prevent duplicate concurrent operations on the same job. These return HTTP 409 if a guard is active.
- **JobIndex**: `refresh()` uses a `refreshInProgress` boolean to prevent concurrent refreshes.
- **SSE Enhancer**: Debounces per `jobId` using a `Map<jobId, timeoutId>`, coalescing rapid changes.
- **Job reads**: `readMultipleJobs` reads all jobs in parallel via `Promise.all`.
- **State endpoint**: Falls back from in-memory state to filesystem snapshot-building; the snapshot builder dynamically imports modules with error catching.

---

## 5. State Management

### In-Memory State

| State | Location | Lifecycle | Cleanup |
|-------|----------|-----------|---------|
| `clients: Set` | SSE registry | Created on first `addClient`, entries added/removed per connection | Cleared on `closeAll()` or when server shuts down |
| `heartbeatTimer` | SSE registry | Started on first client, cleared when last client disconnects | Cleared in `closeAll()` |
| `pending: Map<jobId, timeoutId>` | SSE enhancer | Created per debounced job change | Cleared in `cleanup()` or after each timer fires |
| `seen: Set<jobId>` | SSE enhancer | Tracks whether `job:created` has been emitted for a job ID | Never explicitly cleared (grows monotonically) |
| `restartingJobs, stoppingJobs, startingJobs: Set` | Job control endpoints | Guard sets for concurrent operation prevention | Entries removed in `finally` blocks after operation completes |
| `jobsById: Map` | JobIndex | Populated on `refresh()`, updated on `updateJob()`, cleared on `clear()` | Cleared on `clear()` or `refresh()` (clears then repopulates) |
| `_PATHS` | config-bridge.node.js | Cached path resolution, lazily initialized | Reset via `resetPATHS()` |
| `viteServer` | server.js | Set during development mode startup | Closed during `close()` |
| `watcher` | server.js | Set by `initializeWatcher()` | Stopped during `close()` |
| `heartbeatTimer` | server.js | Set by `startHeartbeat()` (separate from SSE registry heartbeat) | Cleared during `close()` |

### Persisted State

This module reads but does not own the following persisted structures:

| File | Schema | Read/Write | Module |
|------|--------|------------|--------|
| `pipeline-data/{lifecycle}/{jobId}/tasks-status.json` | Job tasks status | Read (job-reader), Write (job-control-endpoints via status-writer) | Multiple |
| `pipeline-data/{lifecycle}/{jobId}/pipeline.json` | Job pipeline config snapshot | Read + Write (rescan endpoint) | job-control-endpoints |
| `pipeline-data/{lifecycle}/{jobId}/job.json` | Job metadata | Read (rescan/restart) | job-control-endpoints |
| `pipeline-data/{lifecycle}/{jobId}/runner.pid` | PID of running pipeline process | Read + Delete (stop endpoint) | job-control-endpoints |
| `pipeline-data/{lifecycle}/{jobId}/seed.json` | Seed data | Write (upload endpoint) | upload-endpoints |
| `pipeline-config/registry.json` | Pipeline registry | Read + Write (create pipeline) | pipelines-endpoint, create-pipeline-endpoint |
| `pipeline-config/{slug}/pipeline.json` | Pipeline definition | Read | multiple endpoints |
| `pipeline-config/{slug}/analysis/*.analysis.json` | Task analysis results | Read + Write | pipeline-analysis, task-analysis, pipeline-artifacts |
| `pipeline-config/{slug}/schemas/*.schema.json`, `*.sample.json` | Deduced schemas | Read + Write | pipeline-analysis, schema-file-endpoint |
| `pipeline-config/{slug}/tasks/index.js` | Task registry | Read + Write | task-save-endpoint, create-pipeline-endpoint |
| `pipeline-config/{slug}/tasks/*.js` | Task source files | Read + Write | pipeline-analysis, task-save-endpoint |

### Shared State

- The `sseRegistry` singleton is shared across `server.js`, `express-app.js`, `sse-broadcast.js`, `sse-enhancer.js`, `sse-endpoints.js`, and `upload-endpoints.js`.
- The `state` module (imported from `ui/state.js`) is shared between `server.js` and `state-endpoint.js`.
- The `_PATHS` cache in `config-bridge.node.js` is module-level and shared across all importers.

### Crash Recovery

- No explicit crash recovery. If the process crashes mid-write, JSON files may be left in a corrupt state. The `readFileWithRetry` mechanism handles transient parse errors (mid-write races) but not persistent corruption.
- The `handleSeedUploadDirect` function tracks `partialFiles` and cleans them up on failure, providing basic rollback for upload operations.
- `handleCreatePipeline` uses atomic temp-file + rename for `registry.json` updates, which is crash-safe for that specific write.
- Job control endpoints use `try/finally` blocks to ensure in-memory guard sets are always cleaned up.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What's Used | Nature | Coupling |
|--------|-------------|--------|----------|
| `core/environment.js` | `loadEnvironment()` | Runtime, called at startup | Loose — only used for `.env` loading |
| `ui/watcher.js` | `start()`, `stop()` | Runtime | Moderate — watcher API is simple |
| `ui/state.js` | `setWatchedPaths()`, `recordChange()`, `getState()` | Runtime | Moderate — relies on state shape |
| `ui/state-snapshot.js` | `buildSnapshotFromFilesystem()` | Runtime (dynamic import) | Loose |
| `config/paths.js` | `resolvePipelinePaths()`, `getJobDirectoryPath()`, `getJobPipelinePath()`, `getJobMetadataPath()`, `getPendingSeedPath()`, `getJobPipelinePath()` | Compile-time | Tight — many path functions used directly |
| `config/statuses.js` | `TaskState`, `JobStatus`, `JobLocation`, `deriveJobStatusFromTasks` | Compile-time | Moderate — enum-like constants |
| `config/models.js` | `PROVIDER_FUNCTIONS` | Compile-time | Loose — read-only data |
| `core/config.js` | `getConfig()`, `getPipelineConfig()` | Runtime | Moderate |
| `core/status-writer.js` | `resetJobToCleanSlate()`, `resetJobFromTask()`, `resetSingleTask()`, `initializeJobArtifacts()`, `writeJobStatus()`, `readJobStatus()` | Runtime | Tight — core job lifecycle operations |
| `core/logger.js` | `createLogger()` | Compile-time | Loose |
| `cli/self-reexec.js` | `buildReexecArgs()` | Runtime | Moderate — used for spawning child processes |
| `task-analysis/index.js` | `analyzeTask()` | Runtime | Moderate |
| `task-analysis/enrichers/*` | `writeAnalysisFile()`, `deduceArtifactSchema()`, `writeSchemaFiles()`, `resolveArtifactReference()` | Runtime | Moderate |
| `llm/index.js` | `createHighLevelLLM()` | Runtime | Loose — used through high-level API |
| `ui/transformers/status-transformer.js` | `transformJobStatus()`, `transformMultipleJobs()` | Compile-time | Moderate |
| `ui/transformers/list-transformer.js` | `aggregateAndSortJobs()`, `transformJobListForAPI()` | Compile-time | Moderate |
| `ui/lib/sse.js` | `streamSSE()` | Runtime | Loose |
| `ui/lib/analysis-lock.js` | `acquireLock()`, `releaseLock()` | Runtime | Loose |
| `ui/lib/mention-parser.js` | `parseMentions()` | Runtime | Loose |
| `ui/lib/schema-loader.js` | `loadSchemaContext()`, `buildSchemaPromptSection()` | Runtime | Loose |
| `ui/lib/task-reviewer.js` | `reviewAndCorrectTask()` | Runtime | Loose |
| `utils/id-generator.js` | `generateJobId()` | Runtime | Loose |
| `api/index.js` | `submitJobWithValidation()` | Runtime (dynamic import, production only) | Loose |

### 6.2 External Dependencies

| Package | What It Provides | Usage | Replaceability |
|---------|------------------|-------|----------------|
| `express` | HTTP framework | Route handling, middleware, static serving, JSON parsing | Deeply used — would require significant rewiring |
| `vite` | Dev server with HMR | Development mode only; dynamically imported | Isolated to dev mode; easily removable |
| `fflate` | Zip decompression | `unzipSync` for zip file extraction | Localized to `zip-utils.js`; easily replaceable |

### 6.3 System-Level Dependencies

- **File system layout**: Expects `pipeline-data/{current,complete,pending,rejected}/` directories under `PO_ROOT`. Expects `pipeline-config/` directory with `registry.json`.
- **Environment variables**:
  - `PO_ROOT` (required in non-test): Base directory for all pipeline data
  - `PORT` (optional): Server port, defaults to 4000
  - `NODE_ENV`: Controls test vs development vs production behavior
  - `WATCHED_PATHS` (optional): Comma-separated directory names to watch
  - `DISABLE_VITE` (optional): Set to `"1"` to skip Vite dev server
  - `JOB_ENDPOINTS_INSTRUMENT` / `UI_LOG_LEVEL`: Debug instrumentation flags
- **Network**: Listens on a TCP port for HTTP connections.
- **Process management**: Uses `child_process.spawn` with `detached: true` to run pipeline jobs in background processes. Uses `process.kill` with `SIGTERM`/`SIGKILL` for stopping jobs. Reads PID files from disk.

---

## 7. Side Effects & I/O

### File System

| Operation | Location | Async | Error Handling |
|-----------|----------|-------|----------------|
| Read `tasks-status.json` | job-reader, job-control-endpoints | Yes | Retry with backoff, structured error envelopes |
| Read `pipeline.json` | Multiple endpoints | Yes | Structured error responses |
| Read `registry.json` | pipelines-endpoint, create-pipeline | Yes | Returns empty array on missing file |
| Read `*.analysis.json` | pipeline-artifacts, task-analysis | Yes | Skips malformed files |
| Read `*.schema.json`, `*.sample.json` | schema-file-endpoint | Yes | 404 on missing |
| Read task source files | pipeline-analysis | Yes | Streams error event on failure |
| Read guidelines markdown | task-creation-endpoint | Sync (`readFileSync`) | Throws if missing |
| Write `tasks-status.json` | job-control-endpoints (via status-writer) | Yes | Propagates errors |
| Write `pipeline.json` (job copy) | job-control-endpoints (rescan) | Yes | 500 on error |
| Write `registry.json` | create-pipeline | Yes | Atomic (temp file + rename) |
| Write analysis files | pipeline-analysis | Yes | Streams error event |
| Write schema files | pipeline-analysis | Yes | Streams error event |
| Write task files | task-save-endpoint | Yes | 500 on error |
| Write `index.js` (task registry) | task-save-endpoint | Yes | 500 on error |
| Write seed/metadata/pipeline files | upload-endpoints | Yes | Partial cleanup on failure |
| Create directories | job-control-endpoints, upload, create-pipeline | Yes | `recursive: true` |
| Delete `runner.pid` | job-control-endpoints (stop) | Yes | Ignores ENOENT |
| Rename (move) job directories | job-control-endpoints | Yes | Atomic rename |
| Static file serving | express-app | Sync (Express static middleware) | 404 fallback |
| Directory listing | file-endpoints, job-scanner | Yes | Returns empty on errors |

### Network

| Operation | Details |
|-----------|---------|
| HTTP server | Listens on configurable port, serves REST API and static assets |
| SSE connections | Long-lived HTTP connections with `text/event-stream` content type |
| CORS | Permissive (`Access-Control-Allow-Origin: *`) on all `/api` routes |
| Vite HMR | WebSocket connection in development mode (managed by Vite) |
| LLM API calls | Outbound HTTP to LLM providers (task-creation, pipeline-analysis via schema-deducer, artifact-resolver) |

### Process Management

| Operation | Details |
|-----------|---------|
| Spawn child processes | `spawn` with `detached: true, stdio: "ignore"` for `_run-job` commands; child is `unref()`'d |
| Kill processes | `process.kill(pid, "SIGTERM")` followed by `process.kill(pid, "SIGKILL")` after 1500ms timeout |
| PID file management | Reads `runner.pid`, deletes after stop attempt |

### Logging & Observability

- Console logging throughout: `console.log`, `console.warn`, `console.error`, `console.debug`, `console.info`.
- Uses `createLogger("TaskCreationEndpoint")` from core logger for task creation endpoint.
- Extensive debug logging for job reading, scanning, SSE broadcasting, path resolution, upload processing, and zip extraction.
- Log prefixes used: `[Server]`, `[JobIndex]`, `[JobScanner]`, `[JobEndpoints]`, `[PipelinesEndpoint]`, `[PipelineTypeDetailEndpoint]`, `[CreatePipelineEndpoint]`, `[PipelineAnalysis]`, `[SSEEnhancer]`, `[UPLOAD]`, `[ZIP]`, `[Router]`.

### Timing & Scheduling

| Timer | Interval | Purpose |
|-------|----------|---------|
| Server heartbeat | 30s | Broadcasts `heartbeat` event to all SSE clients |
| SSE registry heartbeat | 15s | Sends `: keep-alive` comment lines to prevent proxy buffering |
| Per-connection heartbeat | 30s | Sends `event: heartbeat` to individual SSE connections (in `sse-endpoints.js`) |
| SSE enhancer debounce | 200ms | Coalesces rapid job change events per job ID |
| File watcher debounce | 200ms | Passed as option to watcher |
| Server startup timeout | 5s | Rejects if server doesn't start within timeout |
| SIGTERM → SIGKILL wait | 1500ms | Escalation delay for job stop |
| Retry delay | 10-50ms (capped) | Between file read retry attempts |

---

## 8. Error Handling & Failure Modes

### Error Categories

1. **Validation errors** — Invalid job IDs, slugs, filenames, missing required fields, path traversal attempts. Return 400.
2. **Not found errors** — Job not found in any lifecycle directory, pipeline not in registry, file missing. Return 404.
3. **Conflict errors** — Job already running, restart/stop already in progress, analysis lock held. Return 409.
4. **I/O errors** — File system read/write failures, directory access errors. Return 500 or structured error envelopes.
5. **JSON parse errors** — Corrupt or mid-write JSON files. Handled via retry in `readFileWithRetry`, or returned as `INVALID_JSON`.
6. **Process errors** — Failed to spawn child process, failed to kill process. Return 500.
7. **Timeout errors** — Server startup timeout. Throws.
8. **External service errors** — LLM API failures during analysis or task creation. Streamed as SSE error events.

### Propagation Strategy

- **API endpoints**: All endpoint handlers catch errors and return structured JSON responses with appropriate HTTP status codes. Never throw unhandled errors to Express.
- **SSE broadcast**: Double try/catch — first attempts normal broadcast, falls back to summary broadcast, logs if even fallback fails. Never throws.
- **File reader**: Returns structured error envelopes (`{ ok: false, code, message }`), never throws.
- **Job reader**: Returns error envelopes, logs warnings for multi-location search failures.
- **Pipeline analysis**: Streams errors as SSE events, releases analysis lock, closes stream.
- **Upload endpoint**: Returns `{ success: false, message }` JSON responses, cleans up partial files.

### Recovery Behavior

- **File read retries**: Up to 5 attempts with 50ms max delay for transient JSON parse errors.
- **Lock handling**: `readJob` observes locks but does not block — proceeds to read immediately to avoid timing-dependent behavior.
- **Partial file cleanup**: Upload endpoint tracks written files and removes them on failure.
- **Atomic writes**: Pipeline creation uses temp-file + rename for registry updates.
- **Guard cleanup**: Job control endpoints use `try/finally` to always release in-memory concurrency guards.
- **No retry on spawn failure**: If spawning a pipeline runner fails, the error is returned immediately.
- **SSE dead client cleanup**: Happens automatically during every broadcast.

### User/Operator Visibility

- All errors are returned as structured JSON in API responses.
- SSE error events are broadcast for pipeline analysis failures.
- Console logging provides operational visibility into all error paths.

---

## 9. Integration Points & Data Flow

### Upstream (Who calls this module)

- **Browser SPA client** — Makes HTTP requests to all API endpoints and connects via SSE for real-time updates.
- **CLI (`cli/run-orchestrator.js`)** — May start the server via `startServer()`.
- **Main entry point** — `server.js` auto-starts when run directly.

### Downstream (What this module calls)

- **File system** — Reads/writes pipeline data, config, analysis, and schema files.
- **`core/status-writer`** — Writes `tasks-status.json` updates during job control operations.
- **`core/config`** — Reads pipeline configuration and registry data.
- **`task-analysis/*`** — Performs static analysis of task source code.
- **`llm/index.js`** — Calls LLM APIs for task planning and artifact schema deduction.
- **`cli/self-reexec`** — Builds arguments for spawning background pipeline runner processes.
- **`ui/watcher`** — File system watcher for detecting changes.
- **`ui/state`** — In-memory application state management.
- **`ui/transformers/*`** — Transforms raw job data into canonical API schemas.

### Data Transformation

1. **Job list flow**: `listJobs` (directory scan) → `readJob` (file read) → `transformMultipleJobs` (normalize) → `aggregateAndSortJobs` (merge current/complete, sort by status priority) → `transformJobListForAPI` (shape for client) → JSON response.
2. **Job detail flow**: `readJob` (file read) → `transformMultipleJobs` (normalize) → merge with pipeline config → JSON response.
3. **SSE state change flow**: Watcher detects file change → `state.recordChange()` → `broadcastStateUpdate()` → extracts most recent change → decorates with `jobId`/`lifecycle` → broadcasts as `state:change` event.
4. **SSE job update flow**: Job change detected → `sseEnhancer.handleJobChange()` → debounce → `readJob()` → `transformJobStatus()` → `transformJobListForAPI()` → broadcast `job:created`/`job:updated`.
5. **Seed upload flow**: Raw body (JSON/multipart/zip) → `normalizeSeedUpload()` → validate seed → generate job ID → write seed/metadata/pipeline files → initialize artifacts → broadcast `seed:uploaded` → JSON response.
6. **Pipeline analysis flow**: Read pipeline config → read task source files → `analyzeTask()` → `writeAnalysisFile()` → `deduceArtifactSchema()` → `writeSchemaFiles()` → stream progress via SSE.

### Control Flow (Primary Use Cases)

**Server startup:**
1. `startServer()` called → `loadEnvironment()` → `initPATHS(dataDir)` → optionally start Vite → `createServer(dataDir)` → `buildExpressApp()` → `server.listen()` → `initializeWatcher()` → `startHeartbeat()` → return `{ url, close }`.

**Incoming API request:**
1. Express receives request → CORS middleware → route matching → endpoint handler → domain logic → `sendJson()` response.

**Job restart:**
1. Validate jobId → resolve lifecycle → move to current if needed → read status → check guards → parse body for restart mode → reset job state → spawn detached runner → respond 202.

---

## 10. Edge Cases & Implicit Behavior

- **Default port**: Falls back to `4000` if `PORT` is not set. The `PORT` env var is parsed as an integer.
- **Test mode bypasses**: In `NODE_ENV=test`, the watcher and heartbeat are not started. Vite dev server is never started in test mode. Upload endpoint uses simplified direct handling rather than `submitJobWithValidation`.
- **DISABLE_VITE**: When set to `"1"`, Vite dev server is skipped even in development mode.
- **Watched paths default**: In test mode, watches `pipeline-config,runs`; in production, watches `pipeline-config,pipeline-data,runs`. However, `initializeWatcher()` actually builds paths from `resolvePipelinePaths()` regardless of `WATCHED_PATHS` — the `WATCHED_PATHS` env var is stored in state for display but not used for actual watching.
- **SSE dual routes**: Both `/api/events` and `/api/sse` serve the same SSE endpoint.
- **Duplicate functionality**: `broadcastStateUpdate` and `handleApiState` are implemented in both `sse-endpoints.js` and their respective dedicated modules (`sse-broadcast.js` and `state-endpoint.js`). The Express app (`express-app.js`) uses the dedicated `state-endpoint.js` version.
- **BOM handling**: `readJSONFile` strips UTF-8 BOM (byte order mark) if present.
- **File size guard**: `validateFilePath` has dead code checking `MAX_FILE_size` (lowercase 's') with `&& false` — this is a vestigial no-op. The correct check against `MAX_FILE_SIZE` follows.
- **Lock awareness without blocking**: `readJob` checks for `.lock` files but proceeds immediately regardless of lock state. The log message says "retrying" but no retry actually occurs.
- **Retry cap**: `readFileWithRetry` silently caps `maxAttempts` to 5 and `delayMs` to 50ms, regardless of what the caller passes.
- **SSE enhancer `seen` set**: Grows monotonically (never cleared), meaning after a server restart, all jobs are re-emitted as `job:created` on first update.
- **`sendJson` sets `Connection: close`**: The HTTP utility sets `Connection: close` on all JSON responses, and the API guard middleware also sets it for non-SSE requests. This prevents HTTP keep-alive for API calls.
- **Multipart parsing**: The custom multipart parser in `http-utils.js` only supports a single file field named `"file"`. It searches the first 1MB of the body as a string to find headers.
- **SPA fallback**: The `*` catch-all route serves `index.html` for any unmatched path, enabling client-side routing.
- **Embedded assets**: The `embedded-assets.js` file is auto-generated and uses Bun's `with { type: "file" }` import syntax for compiled binary distribution.
- **Job restart modes**: The endpoint supports `clean-slate`, `partial`, `single-task`, and `single-task-continue` modes depending on `fromTask`, `singleTask`, and `continueAfter` body parameters. However, the reset logic for `fromTask` without `singleTask` and with `singleTask` both call `resetSingleTask` identically.
- **SIGTERM escalation**: The stop endpoint waits exactly 1500ms between SIGTERM and checking if the process is still alive. If the process is already dead when SIGTERM is sent, `usedSignal` is set to `null`.
- **Task auto-creation**: `handleTaskStart` will auto-add a task to `tasks-status.json` if it exists in `pipeline.json` but not in the status file.
- **Instrumentation gating**: Job endpoint instrumentation only runs when `JOB_ENDPOINTS_INSTRUMENT=1` or `UI_LOG_LEVEL=debug` and not in test mode.
- **Task code review**: `handleTaskSave` runs LLM-based code review on task code before saving. If review fails, it silently falls back to the original code.

---

## 11. Open Questions & Ambiguities

1. **Duplicate implementations**: `broadcastStateUpdate` exists in both `sse-broadcast.js` and `sse-endpoints.js` with nearly identical code. The `handleApiState` function also exists in both `state-endpoint.js` and `sse-endpoints.js`. It is unclear which are authoritative and whether the duplicates are intentional or an artifact of incremental migration. The Express app uses the dedicated single-purpose modules.

2. **`resetJobFromTask` import**: `job-control-endpoints.js` imports `resetJobFromTask` from `status-writer.js` but never uses it — only `resetSingleTask` and `resetJobToCleanSlate` are called. This may be dead code or a planned feature.

3. **Restart mode parity**: When `fromTask` is set with or without `singleTask`, the code calls `resetSingleTask` in both cases. The branches appear identical, raising the question of whether `resetJobFromTask` (imported but unused) was originally intended for the non-single-task partial restart case.

4. **WATCHED_PATHS vs actual paths**: The `WATCHED_PATHS` env var is parsed and stored in state, but the actual watched directories are derived from `resolvePipelinePaths()`. The `WATCHED_PATHS` value appears to serve no functional purpose beyond state display.

5. **`readJob` location parameter**: `readJob` is called with a `location` parameter in some endpoints (e.g., `handleJobList`) but the function signature in `job-reader.js` does not accept a location parameter — it always searches `current` then `complete`. The extra parameter appears to be silently ignored.

6. **Pipeline config read paths**: Pipeline configuration is read in multiple ways across endpoints — some use `getPipelineConfig(slug)` from core config, others read `registry.json` directly, and job-scoped pipeline configs are read from the job directory. The precedence and consistency of these paths when configs diverge is unclear.

7. **Dead code in `validateFilePath`**: The `MAX_FILE_size` check (line 33 of `file-reader.js`) is gated by `&& false`, making it a permanent no-op. This appears to be a leftover from debugging.

8. **Magic numbers**: The 47-character slug limit, 120-character name limit, 1500ms SIGTERM wait, and 5-second startup timeout lack documented rationale.

9. **`handleSeedUploadDirect` pipeline path**: Reads `pipeline-config/pipeline.json` (a non-slug-specific path) rather than using the seed's `pipeline` field to locate the correct pipeline config. This may not match production behavior which uses `submitJobWithValidation`.

10. **Three heartbeat mechanisms**: There are three separate heartbeat systems: the server-level heartbeat in `server.js` (broadcasts a typed `heartbeat` event), the SSE registry heartbeat (sends `: keep-alive` comment lines), and per-connection heartbeats in `sse-endpoints.js` (sends `event: heartbeat`). The overlap and interaction between these is unclear, and some clients may receive duplicate heartbeat signals.
