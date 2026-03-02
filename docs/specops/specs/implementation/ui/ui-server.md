# Implementation Specification: `ui/server`

**Analysis source:** `docs/specs/analysis/ui/ui-server.md`

---

## 1. Qualifications

- TypeScript strict mode (interfaces, discriminated unions, type-safe route handlers)
- Bun HTTP server APIs (`Bun.serve()`, `Request`/`Response` web standards)
- Bun file I/O (`Bun.file()`, `Bun.write()`)
- Bun subprocess APIs (`Bun.spawn` with detached mode, signal handling)
- Server-Sent Events protocol (SSE framing, keep-alive, `ReadableStream`, `AbortSignal`)
- Web-standard APIs (`Request`, `Response`, `URL`, `URLSearchParams`, `ReadableStream`, `TextDecoder`)
- Filesystem watching (chokidar API surface)
- JSON parsing with error recovery (BOM handling, retry for transient failures)
- Multipart form data parsing
- ZIP file extraction (`fflate`)
- CORS middleware patterns
- Graceful shutdown (SIGTERM/SIGKILL, resource cleanup)
- Concurrent I/O patterns (`Promise.all`, debounce, in-memory guards)

---

## 2. Problem Statement

The system requires an HTTP gateway that exposes a REST API for managing pipeline jobs, tasks, and pipeline definitions; an SSE real-time notification layer; and a static asset server for the SPA frontend. The existing JS implementation provides this via Express with custom middleware, a hand-rolled SSE registry, file-system watchers for change detection, and job reader/scanner modules for disk-based state access. This spec defines the TypeScript replacement, migrating from Express to `Bun.serve()` with web-standard `Request`/`Response`, replacing Node.js-specific I/O with Bun-native APIs, and consolidating duplicate SSE/state implementations.

---

## 3. Goal

A TypeScript module rooted at `src/ui/server/` that provides identical behavioral contracts to the analyzed JS module — HTTP server lifecycle, REST API surface, SSE broadcasting, file watching integration, job reading/scanning, config bridging, and static asset serving — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/ui/server/index.ts` | Server lifecycle: `startServer()`, `createServer()`, watcher initialization, heartbeat, graceful shutdown. Re-exports public API. |
| `src/ui/server/router.ts` | Request routing: URL pattern matching, method dispatch, CORS handling, middleware pipeline, SPA fallback. |
| `src/ui/server/sse-registry.ts` | SSE client registry: connection tracking, heartbeat, broadcast with jobId filtering, dead client cleanup. |
| `src/ui/server/sse-broadcast.ts` | SSE state change broadcasting: extracts and decorates recent file changes, broadcasts as `state:change` or `state:summary` events. |
| `src/ui/server/sse-enhancer.ts` | SSE job enrichment: debounces per-job file changes, reads/transforms job data, broadcasts `job:created`/`job:updated`. |
| `src/ui/server/file-reader.ts` | Safe JSON file reading: validation, BOM handling, retry with backoff, parallel reads, structured error envelopes. |
| `src/ui/server/job-reader.ts` | Job reading: location-precedence search (`current` then `complete`), lock awareness, multi-job parallel reads. |
| `src/ui/server/job-scanner.ts` | Job directory discovery: lists job directories per lifecycle location, stats. |
| `src/ui/server/job-index.ts` | In-memory job cache: refresh, lookup, update, stats. |
| `src/ui/server/config-bridge.ts` | Universal config bridge: constants, validators, error response factory. Browser-safe (no I/O). |
| `src/ui/server/config-bridge-node.ts` | Node/Bun-specific config bridge: path resolution, lock detection, cached PATHS. Extends universal bridge. |
| `src/ui/server/embedded-assets.ts` | Auto-generated embedded asset map for compiled binary distribution. |
| `src/ui/server/zip-utils.ts` | ZIP extraction: parses uploaded zip buffers, extracts seed data and artifacts. |
| `src/ui/server/utils/http-utils.ts` | HTTP response helpers: `sendJson()`, raw body reading, multipart form parsing. |
| `src/ui/server/utils/mime-types.ts` | MIME type mapping and classification. |
| `src/ui/server/utils/slug.ts` | URL-friendly slug generation with uniqueness enforcement. |
| `src/ui/server/endpoints/job-endpoints.ts` | Job list and detail request handlers. |
| `src/ui/server/endpoints/job-control-endpoints.ts` | Job restart, stop, rescan, task start with concurrency guards. |
| `src/ui/server/endpoints/pipelines-endpoint.ts` | Pipeline listing handler. |
| `src/ui/server/endpoints/pipeline-type-detail-endpoint.ts` | Single pipeline type detail handler. |
| `src/ui/server/endpoints/pipeline-analysis-endpoint.ts` | Pipeline analysis with SSE progress streaming and analysis lock. |
| `src/ui/server/endpoints/pipeline-artifacts-endpoint.ts` | Aggregated artifact listing handler. |
| `src/ui/server/endpoints/create-pipeline-endpoint.ts` | Pipeline creation with atomic registry update. |
| `src/ui/server/endpoints/file-endpoints.ts` | Task file listing and serving with path security validation. |
| `src/ui/server/endpoints/upload-endpoints.ts` | Seed file upload (JSON, multipart, ZIP) with partial cleanup on failure. |
| `src/ui/server/endpoints/task-creation-endpoint.ts` | LLM-powered task planning with SSE streaming. |
| `src/ui/server/endpoints/task-save-endpoint.ts` | Task file save with LLM code review. |
| `src/ui/server/endpoints/task-analysis-endpoint.ts` | Cached task analysis data handler. |
| `src/ui/server/endpoints/schema-file-endpoint.ts` | Schema/sample JSON file serving. |
| `src/ui/server/endpoints/state-endpoint.ts` | Application state handler (in-memory or filesystem snapshot). |
| `src/ui/server/endpoints/sse-endpoints.ts` | SSE connection handler with headers, heartbeat, and client registration. |

### Key types and interfaces

```typescript
// ── Server lifecycle ──

interface ServerOptions {
  dataDir: string;
  port?: number;
}

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

// ── Public module surface (index.ts) ──
// The module MUST export these named exports to preserve the analyzed API:
//   startServer(options: ServerOptions): Promise<ServerHandle>
//   createServer(dataDir?: string): { fetch: (req: Request) => Promise<Response> }
//   initializeWatcher(dataDir: string): Promise<void>
//   sseRegistry: SSERegistry              (re-export from sse-registry.ts)
//   broadcastStateUpdate: (...)=> void    (re-export from sse-broadcast.ts)
//   state: StateModule                    (re-export from ui/state)

// ── SSE Registry ──

interface SSEClient {
  controller: ReadableStreamDefaultController;
  jobId?: string;
  signal: AbortSignal;
}

interface SSERegistryOptions {
  heartbeatMs?: number;
  sendInitialPing?: boolean;
}

interface SSERegistry {
  addClient(controller: ReadableStreamDefaultController, signal: AbortSignal, metadata?: { jobId?: string }): void;
  removeClient(controller: ReadableStreamDefaultController): void;
  broadcast(event: SSEEvent): void;
  broadcast(type: string, data: unknown): void;
  broadcast(data: unknown): void;
  getClientCount(): number;
  closeAll(): void;
}

interface SSEEvent {
  type: string;
  data: unknown;
}

// ── SSE Enhancer ──

interface SSEEnhancerOptions {
  readJobFn: (jobId: string) => Promise<JobReadResult>;
  sseRegistry: SSERegistry;
  debounceMs?: number;
}

interface SSEEnhancer {
  handleJobChange(change: { jobId: string; category?: string; filePath?: string }): void;
  getPendingCount(): number;
  cleanup(): void;
}

// ── File Reader ──

interface FileReadSuccess {
  ok: true;
  data: unknown;
  path: string;
}

interface FileValidationSuccess {
  ok: true;
  path: string;
  size: number;
  modified: Date;
}

interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
  path?: string;
}

type FileReadResult = FileReadSuccess | ErrorEnvelope;
type FileValidationResult = FileValidationSuccess | ErrorEnvelope;

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
}

// ── Job Reader ──

interface JobReadSuccess {
  ok: true;
  data: Record<string, unknown>;
  location: string;
  path: string;
}

type JobReadResult = JobReadSuccess | ErrorEnvelope;

// ── Job Scanner ──

interface JobDirectoryStats {
  location: string;
  exists: boolean;
  jobCount: number;
  totalEntries: number;
  error?: string;
}

// ── Job Index ──

interface JobIndexEntry {
  location: string;
  path: string;
  [key: string]: unknown;
}

interface JobIndexStats {
  totalJobs: number;
  byLocation: Record<string, number>;
  lastRefreshAt: string | null;
}

interface JobIndex {
  refresh(): Promise<void>;
  getJob(id: string): JobIndexEntry | undefined;
  getAllJobs(): JobIndexEntry[];
  getJobsByLocation(location: string): JobIndexEntry[];
  hasJob(id: string): boolean;
  getJobCount(): number;
  getStats(): JobIndexStats;
  clear(): void;
  updateJob(id: string, data: Record<string, unknown>, location: string, path: string): void;
  removeJob(id: string): void;
}

// ── Config Bridge (Universal) ──

interface Constants {
  JOB_ID_REGEX: RegExp;
  TASK_STATES: readonly string[];
  JOB_LOCATIONS: readonly string[];
  STATUS_ORDER: readonly string[];
  FILE_LIMITS: { MAX_FILE_SIZE: number };
  RETRY_CONFIG: { MAX_ATTEMPTS: number; DELAY_MS: number };
  SSE_CONFIG: { DEBOUNCE_MS: number };
  ERROR_CODES: {
    NOT_FOUND: string;
    INVALID_JSON: string;
    FS_ERROR: string;
    JOB_NOT_FOUND: string;
    BAD_REQUEST: string;
  };
}

// ── Config Bridge (Node/Bun) ──

interface ResolvedPaths {
  current: string;
  complete: string;
  pending: string;
  rejected: string;
}

// ── HTTP Utils ──

interface MultipartFile {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

// ── Slug Utils ──

// generateSlug(name: string): string
// ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string

// ── ZIP Utils ──

interface ZipExtractionResult {
  seedObject: Record<string, unknown>;
  artifacts: Array<{ filename: string; content: Uint8Array }>;
}

// ── Upload ──

interface SeedUploadResult {
  seedObject: Record<string, unknown>;
  artifacts?: Array<{ filename: string; content: Uint8Array }>;
}

// ── Embedded Assets ──

interface EmbeddedAssetEntry {
  path: string;
  mime: string;
}

// ── File Reading Stats ──

interface FileReadingStats {
  totalFiles: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorTypes: Record<string, number>;
}

// ── Route Handler ──

type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: RouteHandler;
}
```

### Bun-specific design decisions

| Change | Rationale |
|--------|-----------|
| Replace Express with `Bun.serve()` + custom router | Bun's native HTTP server uses web-standard `Request`/`Response`, is significantly faster, eliminates the Express dependency, and aligns with the project's preference for Bun-native APIs. |
| Replace `express.static()` with `Bun.file()` serving | `Bun.file()` provides zero-copy file serving with automatic MIME type detection. The SPA fallback (`index.html`) is handled in the catch-all route. |
| Replace `http.ServerResponse.write()` SSE with `ReadableStream` | SSE connections use `new Response(new ReadableStream(...))` with proper `text/event-stream` headers. Client disconnects are detected via `AbortSignal` from the request. This is the Bun/web-standard approach per AGENTS.md section 5. |
| Replace `child_process.spawn` with `Bun.spawn` | Bun.spawn provides the same `detached` and `stdio` options with better performance and native TypeScript types. |
| Replace `fs.readFile` with `Bun.file().text()` + explicit JSON parse | Native Bun file I/O is faster and more ergonomic. File existence checks use `Bun.file().exists()`. **Do not use `Bun.file().json()`** — the text must be read first via `.text()` so that BOM stripping can occur before `JSON.parse()`. |
| Replace `fs.writeFile` with `Bun.write()` | `Bun.write()` is used for general file writes. **For files requiring atomic replacement** (e.g., `registry.json`, `tasks-status.json`), use a temp-file-and-rename strategy: write to a temporary file in the same directory, then `rename()` to the target path, ensuring readers never see a partial write. |
| Replace `fs.readdir` with `readdir` from `node:fs/promises` | Bun supports `node:fs/promises` natively; `readdir` with `withFileTypes` is needed for directory scanning and is not yet available via a Bun-native equivalent. |
| Replace `fflate.unzipSync` with same | `fflate` is retained — Bun does not provide a native zip extraction API. |
| `URLPattern` for routing | Web-standard URL pattern matching replaces Express route strings. Bun supports `URLPattern` natively. |
| `Connection: close` removed from JSON responses | Bun's HTTP server manages connections efficiently; the explicit `Connection: close` header was an Express workaround. |

### Dependency map

**Internal `src/` imports:**

| This module imports | From |
|---------------------|------|
| `src/core/environment.ts` | `loadEnvironment()` |
| `src/ui/state/` | `state` singleton (recordChange, getState, setWatchedPaths), `buildSnapshotFromFilesystem`, watcher, job-change-detector |
| `src/config/paths.ts` | `resolvePipelinePaths()`, `getJobDirectoryPath()`, `getJobPipelinePath()`, `getJobMetadataPath()`, `getPendingSeedPath()`, `getTaskPath()` |
| `src/config/statuses.ts` | `TaskState`, `JobStatus`, `JobLocation`, `deriveJobStatusFromTasks`, `normalizeTaskState` |
| `src/config/models.ts` | `PROVIDER_FUNCTIONS` |
| `src/core/config.ts` | `getConfig()`, `getPipelineConfig()` |
| `src/core/status-writer.ts` | `resetJobToCleanSlate()`, `resetSingleTask()`, `initializeJobArtifacts()`, `writeJobStatus()`, `readJobStatus()` |
| `src/core/logger.ts` | `createLogger()` |
| `src/cli/self-reexec.ts` | `buildReexecArgs()` |
| `src/task-analysis/index.ts` | `analyzeTask()` |
| `src/task-analysis/enrichers/` | `writeAnalysisFile()`, `deduceArtifactSchema()`, `writeSchemaFiles()`, `resolveArtifactReference()` |
| `src/llm/index.ts` | `createHighLevelLLM()` |
| `src/ui/state/transformers/status-transformer.ts` | `transformJobStatus()`, `transformMultipleJobs()` |
| `src/ui/state/transformers/list-transformer.ts` | `aggregateAndSortJobs()`, `transformJobListForAPI()` |
| `src/ui/state/lib/analysis-lock.ts` | `acquireLock()`, `releaseLock()` |
| `src/ui/state/lib/mention-parser.ts` | `parseMentions()` |
| `src/ui/state/lib/schema-loader.ts` | `loadSchemaContext()`, `buildSchemaPromptSection()` |
| `src/ui/state/lib/task-reviewer.ts` | `reviewAndCorrectTask()` |
| `src/utils/id-generator.ts` | `generateJobId()` |
| `src/api/index.ts` | `submitJobWithValidation()` (dynamic import, production only) |

**External packages:**

| Package | Usage |
|---------|-------|
| `chokidar` | File system watching in `index.ts` (via watcher module) |
| `fflate` | ZIP decompression in `zip-utils.ts` |

---

## 5. Acceptance Criteria

### Core server lifecycle

1. `startServer({ dataDir, port })` returns a `ServerHandle` with `url` and `close`.
2. The server listens on the configured port (default 4000) and responds to HTTP requests.
3. `close()` stops the heartbeat timer, watcher, SSE clients, and HTTP server; the returned promise resolves only when all resources are released.
4. Server startup rejects if the port is already in use (`EADDRINUSE`).
5. Server startup rejects if not started within 5 seconds.
6. `PO_ROOT` is required in non-test environments; missing it throws a descriptive error.

### Routing and CORS

7. All `/api/*` routes include CORS headers (`Access-Control-Allow-Origin: *`).
8. OPTIONS preflight requests return 204 with correct CORS headers.
9. Unmatched routes return `index.html` (SPA fallback) when a static dist directory exists.
10. Static assets are served with correct MIME types from the dist directory or embedded assets.
10a. In development mode, Vite dev server middleware is dynamically imported, created via `createServer()` from `vite`, injected into the request pipeline (before static file serving), and shut down during `close()`. The Vite integration is behind a dynamic import so it does not affect production bundles.

### SSE Registry

11. `addClient` registers a client; `getClientCount()` reflects connected clients.
12. `removeClient` ends the client's stream and decrements the count.
13. `broadcast` sends SSE-framed messages (`event:` + `data:` + `\n\n`) to all connected clients.
14. `broadcast` with `jobId` in the event data only sends to clients registered for that jobId or to clients with no jobId filter.
15. Dead clients (write errors) are cleaned up during broadcast.
16. Heartbeat (`: keep-alive\n\n`) is sent at the configured interval (default 15s) when clients are connected.
17. Heartbeat timer stops when the last client disconnects.
18. `closeAll()` ends all client streams, clears the set, and stops the heartbeat.

### SSE Broadcasting

19. `broadcastStateUpdate` broadcasts exactly one event: `state:change` (with prioritized `tasks-status.json` change) or `state:summary` (with `changeCount`).
20. `broadcastStateUpdate` never throws — errors are caught and logged.
21. `state:change` events are decorated with `jobId` and `lifecycle` extracted from the file path.

### SSE Enhancer

22. `handleJobChange` debounces per jobId (200ms default).
23. After debounce, the enhancer reads the job, transforms it, and broadcasts `job:created` (first occurrence) or `job:updated`.
24. `cleanup()` clears all pending debounce timers.
25. `getPendingCount()` returns the number of pending debounced events.

### File Reader

26. `readJSONFile` reads and parses JSON, strips UTF-8 BOM, and returns `{ ok: true, data, path }`.
27. `readJSONFile` returns an `ErrorEnvelope` for missing files (`NOT_FOUND`), parse failures (`INVALID_JSON`), and I/O errors (`FS_ERROR`).
28. `validateFilePath` returns file metadata on success or `ErrorEnvelope` if the file doesn't exist, isn't a regular file, or exceeds 5MB.
29. `readFileWithRetry` retries on `INVALID_JSON` and `FS_ERROR` up to `maxAttempts` (capped at 5, delay capped at 50ms), but returns immediately for `NOT_FOUND`. Normative defaults: `maxAttempts = 3`, `delayMs = 10` (from `RETRY_CONFIG`). Caller-provided values are accepted but hard-capped at 5 attempts and 50ms delay. In test environments (`NODE_ENV=test`), `delayMs` defaults to `10`.
30. `readMultipleJSONFiles` reads all files in parallel and returns all results.

### Job Reader

31. `readJob(jobId)` searches `current` then `complete`; returns the first match with `{ ok: true, data, location, path }`.
32. `readJob` returns `ErrorEnvelope` with `JOB_NOT_FOUND` if the job is not in any location.
33. `readJob` proceeds immediately even if a lock file is detected (no blocking).
34. `readMultipleJobs` reads all jobs in parallel.

### Job Scanner

35. `listJobs(location)` returns an array of job directory names for the given lifecycle location.
36. `listJobs` returns an empty array on invalid location or errors.
37. `listAllJobs()` returns `{ current: string[], complete: string[] }`.

### Job Index

38. `JobIndex.refresh()` scans and caches all jobs; concurrent refresh calls are prevented.
39. `getJob`, `getAllJobs`, `getJobsByLocation`, `hasJob`, `getJobCount` query the cache.
40. `updateJob` and `removeJob` mutate the cache.
41. `clear()` empties the cache.

### Config Bridge

42. `validateJobId` accepts strings matching `^[A-Za-z0-9-_]+$` and rejects all others.
43. `validateTaskState` accepts only valid task states from the `TaskState` enum.
44. `getStatusPriority` returns numeric priority: running > error > pending > complete.
45. `createErrorResponse` returns `{ ok: false, code, message }` with optional `path`.
46. Node/Bun bridge: `resolvePipelinePaths` returns absolute paths for all lifecycle directories.
47. Node/Bun bridge: `isLocked(jobDir)` detects `.lock` files one level deep.
48. Node/Bun bridge: `getPATHS` caches resolved paths; `resetPATHS` clears the cache.

### HTTP Utilities

49. `sendJson` returns a `Response` with JSON body, correct `Content-Type`, and the given status code.
50. `readRawBody` reads request body up to 2MB, rejects larger bodies.
51. `parseMultipartFormData` extracts file content from multipart requests.

### Slug Utilities

52. `generateSlug` produces kebab-case slugs up to 47 characters.
53. `ensureUniqueSlug` appends numeric suffixes to avoid collisions with the provided set.

### MIME Types

54. `getMimeType` maps filenames to MIME types, defaulting to `application/octet-stream`.
55. `isTextMime` correctly classifies text-based MIME types.

### ZIP Utilities

56. `extractSeedZip` extracts `seed.json` and artifact files from a zip buffer.
57. `extractSeedZip` throws if the zip does not contain a `seed.json`.

### Job Endpoints

58. `GET /api/jobs` returns a sorted, transformed job list with `{ ok: true, data: [...] }`.
59. `GET /api/jobs/:jobId` returns transformed job detail with optional pipeline config.
60. Job detail returns 404 for non-existent jobs with a structured error response.

### Job Control Endpoints

61. `POST /api/jobs/:jobId/restart` resets job state and spawns a detached pipeline runner; returns 202.
62. `POST /api/jobs/:jobId/stop` sends SIGTERM, waits 1500ms, escalates to SIGKILL if needed; resets running tasks.
63. `POST /api/jobs/:jobId/rescan` synchronizes pipeline.json from source and updates tasks-status.json.
64. `POST /api/jobs/:jobId/tasks/:taskId/start` validates dependencies are met, then spawns a runner; returns 202.
65. Concurrent operations on the same job are rejected with 409 via in-memory guard sets; guards are always released in `finally` blocks.

### Pipeline Endpoints

66. `GET /api/pipelines` returns pipeline list from registry.json.
67. `GET /api/pipelines/:slug` returns pipeline type detail with task definitions.
68. `POST /api/pipelines` creates a pipeline with unique slug, directory structure, and atomically updates registry.json.

### Pipeline Analysis

69. `POST /api/pipelines/:slug/analyze` streams SSE progress events (`started`, `task:start`, `artifact:start`, `artifact:complete`, `task:complete`, `complete`, `error`).
70. Analysis enforces the singleton analysis lock; returns 409 if locked.
71. Analysis lock is released on completion or error.

### Upload Endpoints

72. `POST /api/upload/seed` accepts JSON body, multipart JSON file, or multipart ZIP.
73. Seed upload validates the seed object, generates a job ID, and writes seed/metadata/pipeline files.
74. Partial files are cleaned up on upload failure.

### Task Endpoints

75. `POST /api/ai/task-plan` streams LLM-powered task planning via SSE with schema-enriched prompts.
76. `POST /api/tasks/create` saves a task file and updates the task registry `index.js`.
77. `GET /api/pipelines/:slug/tasks/:taskId/analysis` returns cached task analysis data.
78. `GET /api/pipelines/:slug/schemas/:filename` serves schema or sample JSON files.

### File Endpoints

79. File endpoints reject path traversal (`..`), absolute paths, backslashes, and tilde paths with 400.
80. `GET /api/jobs/:jobId/tasks/:taskId/files?type=...` lists files in a task directory.
81. `GET /api/jobs/:jobId/tasks/:taskId/file?type=...&filename=...` serves file content (text as UTF-8, binary as base64).

### State Endpoint

82. `GET /api/state` returns in-memory state if available, otherwise builds and returns a filesystem snapshot.

### SSE Endpoint

83. `GET /api/events` establishes an SSE connection with correct headers, registers the client, and handles disconnect via `AbortSignal`.
84. `GET /api/events?jobId=...` registers the client with a jobId filter for scoped event delivery.

### Atomic Writes

85a. Files that must be updated atomically (`registry.json`, `tasks-status.json`, and any file where a concurrent reader could observe a partial write) use a temp-file-and-rename strategy: `Bun.write()` to a temporary file in the same directory, then `fs.rename()` to the target path.

### Error Handling

85. All endpoints return structured JSON error responses — never unhandled exceptions.
86. File reader errors are returned as `ErrorEnvelope`, never thrown.
87. Job control guards use `try/finally` for cleanup — concurrency guards are never leaked.

### Watcher-to-State-to-SSE Contract

88a. `initializeWatcher(dataDir)` watches the `current` and `complete` lifecycle directories (resolved via `resolvePipelinePaths(dataDir)`).
88b. File change events from chokidar are normalized into `{ path, type, timestamp }` records and passed to `ui/state.recordChange()`.
88c. After state is updated, `broadcastStateUpdate(state.getState())` is called to push changes to SSE clients.
88d. Changes to `tasks-status.json` files additionally trigger `sseEnhancer.handleJobChange({ jobId, category, filePath })` for debounced job enrichment broadcasting.
88e. The watcher's `onChange` callbacks hold no references that outlive `watcher.close()` — after teardown, no further state updates or SSE broadcasts occur from stale callbacks.
88f. `state.setWatchedPaths()` is called during initialization with the resolved watch directories so the state module can report them.

### Graceful Shutdown

88. On `close()`, the server executes the following shutdown sequence in order:
    1. Stop the heartbeat interval timer.
    2. Stop the file watcher (await `watcher.close()`).
    3. Close all SSE clients via `sseRegistry.closeAll()` — in-flight SSE streams are terminated (controllers are closed, not drained).
    4. Clean up the SSE enhancer via `sseEnhancer.cleanup()` (clears pending debounce timers).
    5. If a Vite dev server is running, shut it down via `viteServer.close()`.
    6. Stop the Bun HTTP server via `server.stop()` — this stops accepting new connections. In-flight non-streaming responses are allowed to complete; the stop call does not wait for them indefinitely.
    7. The returned `Promise<void>` resolves only after all of the above steps have completed. If any step throws, the error is logged but shutdown continues through remaining steps (best-effort teardown).

---

## 6. Notes

### Design trade-offs

- **Express → Bun.serve():** The migration from Express to `Bun.serve()` eliminates a major dependency and aligns with the project's Bun-native philosophy. The trade-off is that route handling, middleware, and static file serving must be implemented manually. However, the routing requirements are simple enough that a flat pattern-matching router suffices — no need for a framework.
- **Custom router vs framework:** A lightweight custom router using `URLPattern` is preferred over adopting a Bun-native framework (Elysia, Hono) to minimize new dependencies and keep the migration focused. If the route surface grows significantly, a framework could be introduced later.
- **SSE via ReadableStream:** Moving from Express `res.write()` to `ReadableStream` controllers requires restructuring how clients are tracked. Instead of holding response objects, the registry holds `ReadableStreamDefaultController` references and the client's `AbortSignal` for disconnect detection.
- **Consolidated duplicate code:** The analysis flagged duplicate implementations of `broadcastStateUpdate` and `handleApiState` across `sse-endpoints.js`, `sse-broadcast.js`, and `state-endpoint.js`. The TS migration consolidates these into single authoritative modules (`sse-broadcast.ts` and `state-endpoint.ts`).
- **Three heartbeat mechanisms simplified:** The analysis flagged three overlapping heartbeat systems. The TS migration consolidates to two: the SSE registry heartbeat (`: keep-alive` comments, 15s) to prevent proxy buffering, and the server-level heartbeat (typed `heartbeat` event, 30s) for client-visible connectivity status. Per-connection heartbeats in `sse-endpoints.js` are dropped as redundant.

### Known risks and ambiguities

- **`readJob` location parameter ignored:** The analysis noted that some callers pass a `location` parameter that `readJob` ignores. The TS version will maintain the current behavior (always searching `current` then `complete`) but should document this clearly.
- **SSE enhancer `seen` set grows monotonically:** After a server restart, all jobs re-emit as `job:created`. This is acceptable behavior — clients receive a full refresh on reconnect anyway.
- **`WATCHED_PATHS` env var is display-only:** The actual watched directories come from `resolvePipelinePaths()`. The TS version retains this behavior but adds a comment.
- **Dead code:** The analysis flagged `resetJobFromTask` as imported but unused and `validateFilePath`'s `MAX_FILE_size && false` check. These are omitted from the TS migration.
- **Restart mode ambiguity:** The analysis noted that `fromTask` with and without `singleTask` both call `resetSingleTask` identically. The TS migration preserves this behavior.
- **`handleSeedUploadDirect` pipeline path:** Uses a non-slug-specific `pipeline-config/pipeline.json` path in test mode. This quirk is preserved for test compatibility.

### Migration-specific concerns

- **Behavioral preservation:** All API response shapes, SSE event types and payloads, and error response structures must remain identical. The client SPA depends on these contracts.
- **Static asset serving:** Three modes must work and are all required by acceptance criteria: (1) Vite dev server (development — AC 10a), (2) embedded assets (compiled binary — AC 10), and (3) filesystem dist (standard deployment — AC 10). Vite is dynamically imported so it is excluded from production bundles. The router must check modes in order: Vite (if running) → embedded assets → filesystem dist → SPA fallback.
- **Process spawning:** `Bun.spawn` replaces `child_process.spawn` but must preserve `detached: true` behavior for background pipeline runners. `unref()` is replaced by Bun's equivalent mechanism.
- **Multipart parsing:** The custom multipart parser must be reimplemented to work with `Request.arrayBuffer()` instead of Express's request stream.

### Dependencies on other modules

- Depends on `src/config/statuses.ts` being migrated first (provides `TaskState`, `JobStatus`, `JobLocation` enums).
- Depends on `src/config/paths.ts` being migrated first (provides path resolution).
- Depends on `src/core/status-writer.ts` for job reset operations.
- Depends on `src/ui/state/` module for state management, watcher, transformers, and SSE support utilities.
- The `src/ui/state/` module spec should be implemented concurrently or before this module. Shims may be needed for transformer and state imports during incremental migration.

### Performance considerations

- `Bun.serve()` is significantly faster than Express for HTTP request handling.
- `Bun.file()` provides zero-copy file serving for static assets.
- `Bun.write()` is faster than `fs.writeFile` for atomic writes.
- The SSE registry's `ReadableStream` approach avoids buffering and provides backpressure.

---

## 7. Implementation Steps

### Step 1: Create `src/ui/server/config-bridge.ts` — universal constants and validators

**What to do:** Create the universal (browser-safe) config bridge module. Define the `Constants` object with `JOB_ID_REGEX`, `TASK_STATES`, `JOB_LOCATIONS`, `STATUS_ORDER`, `FILE_LIMITS`, `RETRY_CONFIG`, `SSE_CONFIG`, and `ERROR_CODES`. Export `validateJobId(jobId: string): boolean`, `validateTaskState(state: string): boolean`, `getStatusPriority(status: string): number`, `determineJobStatus(tasks: Record<string, { state: string }>): string`, and `createErrorResponse(code: string, message: string, path?: string): ErrorEnvelope`.

**Why:** All other modules depend on these constants and validators. Acceptance criteria 42–45.

**Type signatures:**
```typescript
export const Constants: {
  JOB_ID_REGEX: RegExp;
  TASK_STATES: readonly string[];
  JOB_LOCATIONS: readonly string[];
  STATUS_ORDER: readonly string[];
  FILE_LIMITS: { MAX_FILE_SIZE: number };
  RETRY_CONFIG: { MAX_ATTEMPTS: number; DELAY_MS: number };
  SSE_CONFIG: { DEBOUNCE_MS: number };
  ERROR_CODES: { NOT_FOUND: string; INVALID_JSON: string; FS_ERROR: string; JOB_NOT_FOUND: string; BAD_REQUEST: string };
};
export function validateJobId(jobId: string): boolean;
export function validateTaskState(state: string): boolean;
export function getStatusPriority(status: string): number;
export function determineJobStatus(tasks: Record<string, { state: string }>): string;
export function createErrorResponse(code: string, message: string, path?: string): ErrorEnvelope;
```

**Test:** `tests/ui/server/config-bridge.test.ts`
- `validateJobId` accepts `"abc-123_XYZ"`, rejects `"../etc"`, `""`, `"a b"`.
- `validateTaskState` accepts each value in `TASK_STATES`, rejects `"invalid"`.
- `getStatusPriority` returns `4` for running, `3` for error, `2` for pending, `1` for complete, `0` for unknown.
- `createErrorResponse` returns `{ ok: false, code: "NOT_FOUND", message: "..." }`.

---

### Step 2: Create `src/ui/server/config-bridge-node.ts` — Bun-specific path resolution

**What to do:** Create the Node/Bun-specific config bridge. Re-export everything from `config-bridge.ts`. Add `resolvePipelinePaths(root?: string): ResolvedPaths`, `getJobPath(jobId: string, location?: string): string`, `getTasksStatusPath(jobId: string, location?: string): string`, `getSeedPath(jobId: string, location?: string): string`, `getTaskPath(jobId: string, taskName: string, location?: string): string`, `isLocked(jobDir: string): Promise<boolean>`, `initPATHS(root: string): void`, `resetPATHS(): void`, `getPATHS(root?: string): ResolvedPaths`. Override `RETRY_CONFIG.DELAY_MS` to `10` in test environment.

**Why:** Path resolution and lock detection are needed by file reader, job reader, job scanner, and endpoints. Acceptance criteria 46–48.

**Type signatures:**
```typescript
export function resolvePipelinePaths(root?: string): ResolvedPaths;
export function getJobPath(jobId: string, location?: string): string;
export function getTasksStatusPath(jobId: string, location?: string): string;
export function getSeedPath(jobId: string, location?: string): string;
export function getTaskPath(jobId: string, taskName: string, location?: string): string;
export function isLocked(jobDir: string): Promise<boolean>;
export function initPATHS(root: string): void;
export function resetPATHS(): void;
export function getPATHS(root?: string): ResolvedPaths;
```

**Test:** `tests/ui/server/config-bridge-node.test.ts`
- `resolvePipelinePaths("/tmp/test")` returns `{ current: "/tmp/test/pipeline-data/current", ... }`.
- `getJobPath("job-1", "current")` returns the expected absolute path.
- `isLocked` returns `true` when a `.lock` file exists in the job directory, `false` otherwise.
- `initPATHS`/`resetPATHS`/`getPATHS` caching works correctly.

---

### Step 3: Create `src/ui/server/utils/mime-types.ts`

**What to do:** Define the `MIME_MAP` object covering text, code, web, data, image, audio, video, archive, font, and miscellaneous extensions. Export `getMimeType(filename: string): string` (defaults to `application/octet-stream`) and `isTextMime(mime: string): boolean`.

**Why:** Needed by file endpoints and static asset serving. Acceptance criteria 54–55.

**Type signatures:**
```typescript
export const MIME_MAP: Readonly<Record<string, string>>;
export function getMimeType(filename: string): string;
export function isTextMime(mime: string): boolean;
```

**Test:** `tests/ui/server/utils/mime-types.test.ts`
- `getMimeType("file.json")` returns `"application/json"`.
- `getMimeType("file.unknown")` returns `"application/octet-stream"`.
- `isTextMime("text/plain")` returns `true`.
- `isTextMime("image/png")` returns `false`.

---

### Step 4: Create `src/ui/server/utils/slug.ts`

**What to do:** Export `generateSlug(name: string): string` that converts to lowercase, replaces non-alphanumeric with hyphens, collapses consecutive hyphens, trims leading/trailing hyphens, and caps at 47 characters. Export `ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string` that appends `-2`, `-3`, etc. if needed.

**Why:** Needed by the create pipeline endpoint. Acceptance criteria 52–53.

**Type signatures:**
```typescript
export function generateSlug(name: string): string;
export function ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string;
```

**Test:** `tests/ui/server/utils/slug.test.ts`
- `generateSlug("My Pipeline Name!")` returns `"my-pipeline-name"`.
- `generateSlug` output never exceeds 47 characters.
- `ensureUniqueSlug("test", new Set(["test"]))` returns `"test-2"`.
- `ensureUniqueSlug("test", new Set(["test", "test-2"]))` returns `"test-3"`.

---

### Step 5: Create `src/ui/server/utils/http-utils.ts`

**What to do:** Export `sendJson(statusCode: number, data: unknown): Response` that returns a `Response` with JSON body and `Content-Type: application/json`. Export `readRawBody(req: Request, maxBytes?: number): Promise<Uint8Array>` with 2MB default limit that throws on oversize. Export `parseMultipartFormData(req: Request): Promise<{ fields: Record<string, string>; files: MultipartFile[] }>` that parses `multipart/form-data` from the request body.

**Why:** Used by all endpoints for response formatting and upload handling. Acceptance criteria 49–51.

**Type signatures:**
```typescript
export function sendJson(statusCode: number, data: unknown): Response;
export function readRawBody(req: Request, maxBytes?: number): Promise<Uint8Array>;
export function parseMultipartFormData(req: Request): Promise<{ fields: Record<string, string>; files: MultipartFile[] }>;
```

**Test:** `tests/ui/server/utils/http-utils.test.ts`
- `sendJson(200, { ok: true })` returns a Response with status 200, correct content-type, and body `{"ok":true}`.
- `readRawBody` rejects when body exceeds `maxBytes`.
- `parseMultipartFormData` extracts file content from a well-formed multipart body.

---

### Step 6: Create `src/ui/server/file-reader.ts`

**What to do:** Export `validateFilePath(filePath: string): Promise<FileValidationResult>` using `Bun.file()` for existence/size checks. Export `readJSONFile(filePath: string): Promise<FileReadResult>` using `Bun.file().text()` with BOM stripping and JSON parsing. Export `readFileWithRetry(filePath: string, options?: RetryOptions): Promise<FileReadResult>` with retry logic (no retry for NOT_FOUND, cap at 5 attempts and 50ms delay). Export `readMultipleJSONFiles(filePaths: string[]): Promise<FileReadResult[]>` using `Promise.all`. Export `getFileReadingStats(filePaths: string[], results: FileReadResult[]): FileReadingStats`.

**Why:** Safe file reading is the foundation for all disk-based operations. Acceptance criteria 26–30.

**Type signatures:**
```typescript
export function validateFilePath(filePath: string): Promise<FileValidationResult>;
export function readJSONFile(filePath: string): Promise<FileReadResult>;
export function readFileWithRetry(filePath: string, options?: RetryOptions): Promise<FileReadResult>;
export function readMultipleJSONFiles(filePaths: string[]): Promise<FileReadResult[]>;
export function getFileReadingStats(filePaths: string[], results: FileReadResult[]): FileReadingStats;
```

**Test:** `tests/ui/server/file-reader.test.ts`
- `readJSONFile` on a valid JSON file returns `{ ok: true, data: {...}, path }`.
- `readJSONFile` on a file with UTF-8 BOM returns parsed data (BOM stripped).
- `readJSONFile` on a missing file returns `{ ok: false, code: "NOT_FOUND" }`.
- `readJSONFile` on invalid JSON returns `{ ok: false, code: "INVALID_JSON" }`.
- `validateFilePath` returns `{ ok: false }` for files over 5MB.
- `readFileWithRetry` returns immediately for NOT_FOUND without retrying.
- `readFileWithRetry` caps attempts at 5 and delay at 50ms regardless of options.
- `readMultipleJSONFiles` reads all files in parallel.

---

### Step 7: Create `src/ui/server/job-scanner.ts`

**What to do:** Export `listJobs(location: string): Promise<string[]>` that reads the lifecycle directory and returns job directory names (filtering to directories only using `readdir` with `withFileTypes`). Return empty array on invalid location or I/O errors. Export `listAllJobs(): Promise<{ current: string[]; complete: string[] }>`. Export `getJobDirectoryStats(location: string): Promise<JobDirectoryStats>`.

**Why:** Job scanning is used by the job index and job list endpoints. Acceptance criteria 35–37.

**Type signatures:**
```typescript
export function listJobs(location: string): Promise<string[]>;
export function listAllJobs(): Promise<{ current: string[]; complete: string[] }>;
export function getJobDirectoryStats(location: string): Promise<JobDirectoryStats>;
```

**Test:** `tests/ui/server/job-scanner.test.ts`
- `listJobs("current")` returns directory names from the current pipeline-data directory.
- `listJobs("invalid")` returns `[]`.
- `listAllJobs()` returns `{ current: [...], complete: [...] }`.
- `getJobDirectoryStats` returns correct counts and existence flag.

---

### Step 8: Create `src/ui/server/job-reader.ts`

**What to do:** Export `readJob(jobId: string): Promise<JobReadResult>` that validates the jobId, checks `current` then `complete` for `tasks-status.json`, uses `readFileWithRetry`, and checks for lock files via `isLocked`. Export `readMultipleJobs(jobIds: string[]): Promise<JobReadResult[]>` using `Promise.all`. Export `getJobReadingStats(...)`.

**Why:** Job reading is used by endpoints and the SSE enhancer. Acceptance criteria 31–34.

**Type signatures:**
```typescript
export function readJob(jobId: string): Promise<JobReadResult>;
export function readMultipleJobs(jobIds: string[]): Promise<JobReadResult[]>;
export function getJobReadingStats(jobIds: string[], results: JobReadResult[]): { totalJobs: number; successCount: number; errorCount: number; successRate: number; errorTypes: Record<string, number>; locations: Record<string, number> };
```

**Test:** `tests/ui/server/job-reader.test.ts`
- `readJob("valid-id")` with a job in `current` returns `{ ok: true, location: "current" }`.
- `readJob("valid-id")` with a job only in `complete` returns `{ ok: true, location: "complete" }`.
- `readJob("missing")` returns `{ ok: false, code: "JOB_NOT_FOUND" }`.
- `readJob("../bad")` returns `{ ok: false, code: "BAD_REQUEST" }`.
- `readJob` proceeds even when lock file exists.
- `readMultipleJobs` reads all jobs in parallel.

---

### Step 9: Create `src/ui/server/job-index.ts`

**What to do:** Export the `JobIndex` class with methods `refresh()`, `getJob(id)`, `getAllJobs()`, `getJobsByLocation(location)`, `hasJob(id)`, `getJobCount()`, `getStats()`, `clear()`, `updateJob(id, data, location, path)`, `removeJob(id)`. Use an internal `Map<string, JobIndexEntry>`. Prevent concurrent refreshes with a boolean guard. Export factory `createJobIndex()`, singleton getter `getJobIndex()`, and `resetJobIndex()`.

**Why:** In-memory job cache for fast lookups. Acceptance criteria 38–41.

**Type signatures:**
```typescript
export class JobIndex { ... }
export function createJobIndex(): JobIndex;
export function getJobIndex(): JobIndex;
export function resetJobIndex(): void;
```

**Test:** `tests/ui/server/job-index.test.ts`
- After `refresh()`, `getAllJobs()` returns cached job entries.
- `getJob("id")` returns the matching entry or `undefined`.
- `updateJob` inserts or replaces an entry; `getJob` reflects the update.
- `removeJob` deletes an entry; `hasJob` returns `false`.
- Concurrent `refresh()` calls do not run in parallel (second call is a no-op while first is in progress).

---

### Step 10: Create `src/ui/server/zip-utils.ts`

**What to do:** Export `extractSeedZip(zipBuffer: Uint8Array): Promise<ZipExtractionResult>` using `fflate.unzipSync`. Find `seed.json` in the extracted files, parse it. Collect remaining files as artifacts with their filenames and content.

**Why:** Needed for ZIP upload support. Acceptance criteria 56–57.

**Type signatures:**
```typescript
export function extractSeedZip(zipBuffer: Uint8Array): Promise<ZipExtractionResult>;
```

**Test:** `tests/ui/server/zip-utils.test.ts`
- Valid zip with `seed.json` and artifacts extracts correctly.
- Zip missing `seed.json` throws an error with descriptive message.

---

### Step 11: Create `src/ui/server/sse-registry.ts`

**What to do:** Export `createSSERegistry(options?: SSERegistryOptions): SSERegistry`. Internally maintain a `Set<SSEClient>`. Implement `addClient` (stores controller + signal + optional jobId, starts heartbeat on first client, registers signal abort listener for auto-removal). Implement `removeClient` (controller lookup and removal, stop heartbeat if empty). Implement `broadcast` with three overloads, JSON serialization, jobId filtering logic, and dead client cleanup (catch write errors). Implement `getClientCount` and `closeAll`. Also export singleton `sseRegistry` with `{ heartbeatMs: 15000, sendInitialPing: true }`.

**Why:** Central SSE infrastructure used by all real-time features. Acceptance criteria 11–18.

**Type signatures:**
```typescript
export function createSSERegistry(options?: SSERegistryOptions): SSERegistry;
export const sseRegistry: SSERegistry;
```

**Test:** `tests/ui/server/sse-registry.test.ts`
- `addClient` increases `getClientCount()` by 1.
- `removeClient` decreases count and closes the client's stream.
- `broadcast({ type: "test", data: { msg: "hi" } })` sends `event: test\ndata: {"msg":"hi"}\n\n` to all clients.
- `broadcast` with `jobId` in data only sends to matching or unfiltered clients.
- Dead clients (controller that throws on enqueue) are cleaned up during broadcast.
- Heartbeat timer starts on first client, stops when count reaches 0.
- `closeAll()` clears all clients and stops heartbeat.

---

### Step 12: Create `src/ui/server/sse-broadcast.ts`

**What to do:** Export `broadcastStateUpdate(currentState: { recentChanges: Array<{ path: string; type: string; timestamp: string }>; changeCount: number }): void`. Extract `recentChanges`, find and prioritize `tasks-status.json` changes, decorate with `jobId` and `lifecycle` parsed from the path, broadcast as `state:change`. If no recent changes, broadcast `state:summary` with `changeCount`. Wrap in double try/catch — never throw.

**Why:** Bridges file watcher changes to SSE clients. Acceptance criteria 19–21.

**Type signatures:**
```typescript
export function broadcastStateUpdate(currentState: { recentChanges: Array<{ path: string; type: string; timestamp: string }>; changeCount: number }): void;
```

**Test:** `tests/ui/server/sse-broadcast.test.ts`
- With a `tasks-status.json` change in recentChanges, broadcasts `state:change` with `jobId` and `lifecycle`.
- With no recent changes, broadcasts `state:summary` with `changeCount`.
- Never throws even when broadcast fails internally.

---

### Step 13: Create `src/ui/server/sse-enhancer.ts`

**What to do:** Export `createSSEEnhancer(options: SSEEnhancerOptions): SSEEnhancer`. Maintain a `pending: Map<string, Timer>` for debounce and `seen: Set<string>` for created/updated tracking. `handleJobChange` sets/resets a timer per jobId. On fire: read job, transform via `transformJobStatus` and `transformJobListForAPI`, broadcast `job:created` (first time for this jobId) or `job:updated`. Export singleton `sseEnhancer` (may be null if dependencies unavailable).

**Why:** Enriches raw file changes into meaningful job events for the client. Acceptance criteria 22–25.

**Type signatures:**
```typescript
export function createSSEEnhancer(options: SSEEnhancerOptions): SSEEnhancer;
export const sseEnhancer: SSEEnhancer | null;
```

**Test:** `tests/ui/server/sse-enhancer.test.ts`
- `handleJobChange({ jobId: "j1" })` does not broadcast immediately (debounced).
- After debounce period, broadcasts `job:created` on first occurrence, `job:updated` on subsequent.
- `getPendingCount()` reflects pending debounced events.
- `cleanup()` clears all pending timers; `getPendingCount()` returns 0.

---

### Step 14: Create `src/ui/server/router.ts`

**What to do:** Export `createRouter(): { addRoute(method: string, path: string, handler: RouteHandler): void; handle(req: Request): Promise<Response> }`. Use `URLPattern` for route matching. Handle CORS headers on all `/api/*` responses. Handle OPTIONS preflight. Implement SPA fallback for unmatched GET requests (serve `index.html`). Implement static asset serving via `Bun.file()` with MIME type lookup.

**Why:** Replaces Express routing. Acceptance criteria 7–10.

**Type signatures:**
```typescript
export function createRouter(): {
  addRoute(method: string, path: string, handler: RouteHandler): void;
  handle(req: Request): Promise<Response>;
};
```

**Test:** `tests/ui/server/router.test.ts`
- Registered routes match and dispatch to handlers.
- `/api/*` responses include CORS headers.
- OPTIONS requests return 204 with CORS headers.
- Unmatched GET requests return the SPA fallback HTML.
- URL params are extracted and passed to handlers.

---

### Step 15: Create endpoint handlers — job endpoints

**What to do:** Create `src/ui/server/endpoints/job-endpoints.ts`. Export `handleJobList(): Promise<Response>` (scans jobs, reads, transforms, aggregates, sorts, returns list). Export `handleJobDetail(jobId: string): Promise<Response>` (validates, reads, transforms, enriches with pipeline config). Both return JSON via `sendJson`.

**Why:** Core API for job data access. Acceptance criteria 58–60.

**Type signatures:**
```typescript
export function handleJobList(): Promise<Response>;
export function handleJobDetail(jobId: string): Promise<Response>;
```

**Test:** `tests/ui/server/endpoints/job-endpoints.test.ts`
- `handleJobList()` returns `{ ok: true, data: [...] }` with transformed jobs.
- `handleJobDetail("valid-id")` returns the transformed job with pipeline config.
- `handleJobDetail("missing")` returns 404 with `{ ok: false, code: "JOB_NOT_FOUND" }`.

---

### Step 16: Create endpoint handlers — job control endpoints

**What to do:** Create `src/ui/server/endpoints/job-control-endpoints.ts`. Export `handleJobRestart(req: Request, jobId: string, dataDir: string): Promise<Response>`, `handleJobStop(req: Request, jobId: string, dataDir: string): Promise<Response>`, `handleJobRescan(req: Request, jobId: string, dataDir: string): Promise<Response>`, `handleTaskStart(req: Request, jobId: string, taskId: string, dataDir: string): Promise<Response>`. Use `Bun.spawn` with `detached` for pipeline runner. Implement in-memory `Set` guards (`restartingJobs`, `stoppingJobs`, `startingJobs`) with `try/finally` cleanup. Export guard functions: `isRestartInProgress`, `beginRestart`, `endRestart`, etc. Export `resolveJobLifecycle(dataDir: string, jobId: string): Promise<string | null>`.

**Why:** Job control is the core mutation API. Acceptance criteria 61–65.

**Type signatures:**
```typescript
export function handleJobRestart(req: Request, jobId: string, dataDir: string): Promise<Response>;
export function handleJobStop(req: Request, jobId: string, dataDir: string): Promise<Response>;
export function handleJobRescan(req: Request, jobId: string, dataDir: string): Promise<Response>;
export function handleTaskStart(req: Request, jobId: string, taskId: string, dataDir: string): Promise<Response>;
export function resolveJobLifecycle(dataDir: string, jobId: string): Promise<string | null>;
```

**Test:** `tests/ui/server/endpoints/job-control-endpoints.test.ts`
- `handleJobRestart` returns 202 on success; spawns a detached process.
- Concurrent restart on the same job returns 409.
- Guard sets are cleaned up even when the handler throws.
- `handleJobStop` sends SIGTERM; escalates to SIGKILL after 1500ms if process still alive.
- `handleTaskStart` returns 400 if upstream dependencies are not met.

---

### Step 17: Create endpoint handlers — pipeline endpoints

**What to do:** Create `src/ui/server/endpoints/pipelines-endpoint.ts` with `handlePipelinesList(): Promise<Response>` (reads registry.json). Create `src/ui/server/endpoints/pipeline-type-detail-endpoint.ts` with `handlePipelineTypeDetail(slug: string): Promise<Response>` (reads pipeline.json, returns tasks). Create `src/ui/server/endpoints/create-pipeline-endpoint.ts` with `handleCreatePipeline(req: Request): Promise<Response>` (validates, generates slug, creates dirs, writes starter files, atomically updates registry.json via temp file + rename).

**Why:** Pipeline management API. Acceptance criteria 66–68.

**Type signatures:**
```typescript
// pipelines-endpoint.ts
export function handlePipelinesList(): Promise<Response>;
// pipeline-type-detail-endpoint.ts
export function handlePipelineTypeDetail(slug: string): Promise<Response>;
// create-pipeline-endpoint.ts
export function handleCreatePipeline(req: Request): Promise<Response>;
```

**Test:** `tests/ui/server/endpoints/pipelines-endpoint.test.ts`
- `handlePipelinesList()` returns pipeline entries from registry.json.
- `handlePipelineTypeDetail("my-pipeline")` returns task definitions.
- `handleCreatePipeline` creates directory structure, writes files, updates registry atomically.
- Duplicate slug names get numeric suffixes.

---

### Step 18: Create endpoint handlers — pipeline analysis

**What to do:** Create `src/ui/server/endpoints/pipeline-analysis-endpoint.ts` with `handlePipelineAnalysis(req: Request, slug: string): Promise<Response>`. Acquire the analysis lock, read pipeline config, iterate tasks, analyze each via `analyzeTask()`, deduce schemas via `deduceArtifactSchema()`, stream progress as SSE events (`started`, `task:start`, `artifact:start`, `artifact:complete`, `task:complete`, `complete`, `error`). Release lock on completion or error. Return a `Response` with `ReadableStream`.

**Why:** Pipeline analysis with live progress streaming. Acceptance criteria 69–71.

**Type signatures:**
```typescript
export function handlePipelineAnalysis(req: Request, slug: string): Promise<Response>;
```

**Test:** `tests/ui/server/endpoints/pipeline-analysis-endpoint.test.ts`
- Streams SSE progress events in correct order.
- Returns 409 when analysis lock is held.
- Releases lock on successful completion.
- Releases lock on error.

---

### Step 19: Create endpoint handlers — file, upload, task, schema, state, SSE endpoints

**What to do:** Create the remaining endpoint files:
- `file-endpoints.ts`: `validateFileName(filename: string): boolean` (rejects `..`, absolute paths, backslashes, tilde), `handleTaskFileList(req: Request, jobId: string, taskId: string): Promise<Response>`, `handleTaskFile(req: Request, jobId: string, taskId: string): Promise<Response>`.
- `upload-endpoints.ts`: `handleSeedUpload(req: Request, dataDir: string): Promise<Response>`, `normalizeSeedUpload(req: Request): Promise<SeedUploadResult>`, `handleSeedUploadDirect(seedObject: Record<string, unknown>, dataDir: string, artifacts?: Array<{filename: string; content: Uint8Array}>): Promise<Response>`.
- `pipeline-artifacts-endpoint.ts`: `handlePipelineArtifacts(req: Request, slug: string): Promise<Response>`.
- `task-creation-endpoint.ts`: `handleTaskPlan(req: Request): Promise<Response>`.
- `task-save-endpoint.ts`: `handleTaskSave(req: Request): Promise<Response>`.
- `task-analysis-endpoint.ts`: `handleTaskAnalysis(req: Request, slug: string, taskId: string): Promise<Response>`.
- `schema-file-endpoint.ts`: `handleSchemaFile(req: Request, slug: string, filename: string): Promise<Response>`.
- `state-endpoint.ts`: `handleApiState(): Promise<Response>`.
- `sse-endpoints.ts`: `handleSseEvents(req: Request): Response`.

**Why:** Completes the API surface. Acceptance criteria 72–84.

**Test:** `tests/ui/server/endpoints/remaining-endpoints.test.ts`
- File path validation rejects `"../etc/passwd"`, `"/absolute"`, `"back\\slash"`, `"~/home"`.
- Seed upload handles JSON body, multipart JSON, and multipart ZIP.
- `handleApiState()` returns in-memory state or filesystem snapshot.
- `handleSseEvents` returns a Response with `Content-Type: text/event-stream` and a ReadableStream body.
- SSE endpoint with `?jobId=...` registers client with jobId filter.

---

### Step 20: Create `src/ui/server/embedded-assets.ts`

**What to do:** Create a placeholder module that exports `embeddedAssets: Record<string, EmbeddedAssetEntry>` as an empty object. Document that this file is auto-generated during the build process for compiled binary distribution.

**Why:** Static asset serving for compiled binary mode. Acceptance criterion 10.

**Test:** No test needed — this is an auto-generated file. Verify that the export type is correct.

---

### Step 21: Create `src/ui/server/router.ts` — wire all endpoints

**What to do:** Update the router to register all endpoint handlers with their URL patterns and HTTP methods. Include the full route table:
- `GET /api/jobs` → `handleJobList`
- `GET /api/jobs/:jobId` → `handleJobDetail`
- `POST /api/jobs/:jobId/restart` → `handleJobRestart`
- `POST /api/jobs/:jobId/stop` → `handleJobStop`
- `POST /api/jobs/:jobId/rescan` → `handleJobRescan`
- `POST /api/jobs/:jobId/tasks/:taskId/start` → `handleTaskStart`
- `GET /api/jobs/:jobId/tasks/:taskId/files` → `handleTaskFileList`
- `GET /api/jobs/:jobId/tasks/:taskId/file` → `handleTaskFile`
- `GET /api/pipelines` → `handlePipelinesList`
- `GET /api/pipelines/:slug` → `handlePipelineTypeDetail`
- `POST /api/pipelines` → `handleCreatePipeline`
- `POST /api/pipelines/:slug/analyze` → `handlePipelineAnalysis`
- `GET /api/pipelines/:slug/artifacts` → `handlePipelineArtifacts`
- `GET /api/pipelines/:slug/tasks/:taskId/analysis` → `handleTaskAnalysis`
- `GET /api/pipelines/:slug/schemas/:filename` → `handleSchemaFile`
- `POST /api/ai/task-plan` → `handleTaskPlan`
- `POST /api/tasks/create` → `handleTaskSave`
- `GET /api/state` → `handleApiState`
- `GET /api/events` → `handleSseEvents`
- `GET /api/sse` → `handleSseEvents` (dual route)
- `POST /api/upload/seed` → `handleSeedUpload`

**Why:** Wires the full API surface. Acceptance criteria 7–10, 58–84.

**Test:** `tests/ui/server/router-integration.test.ts`
- Each registered route dispatches to its handler.
- `/api/events` and `/api/sse` both reach the SSE handler.
- Static assets are served from the dist directory when present.
- SPA fallback returns `index.html` for unknown GET paths.

---

### Step 22: Create `src/ui/server/index.ts` — server lifecycle

**What to do:** Export `startServer(options: ServerOptions): Promise<ServerHandle>`. Load environment, initialize PATHS, optionally start Vite (dev mode, dynamically imported), create the router, start `Bun.serve()` on the configured port. Start the watcher via `initializeWatcher(dataDir)` which watches `current` and `complete` lifecycle directories, normalizes change events into `{ path, type, timestamp }`, feeds them to `state.recordChange()`, calls `broadcastStateUpdate()`, and triggers the SSE enhancer for `tasks-status.json` changes (see AC 88a–88f). Start the heartbeat timer (30s interval broadcasting `heartbeat` event). Return `{ url, close }` where `close` executes the shutdown sequence defined in AC 88: (1) stop heartbeat timer, (2) stop watcher, (3) close all SSE clients, (4) cleanup SSE enhancer, (5) close Vite if running, (6) stop Bun HTTP server. Each step is best-effort — errors are logged but do not prevent subsequent steps. The returned promise resolves only after all steps complete. Handle `EADDRINUSE` and 5s startup timeout. Export `createServer(dataDir?: string)` for direct server creation without startup side effects. Re-export `sseRegistry`, `broadcastStateUpdate`, and `state`.

**Why:** Server lifecycle is the entry point for the module. Acceptance criteria 1–6, 88.

**Type signatures:**
```typescript
export function startServer(options: ServerOptions): Promise<ServerHandle>;
export function createServer(dataDir?: string): { fetch: (req: Request) => Promise<Response> };
export function initializeWatcher(dataDir: string): Promise<void>;
// Re-exports — these MUST be named exports from index.ts:
export { sseRegistry } from './sse-registry';
export { broadcastStateUpdate } from './sse-broadcast';
export { state } from '../../ui/state';
```

**Test:** `tests/ui/server/index.test.ts`
- `startServer` returns a `ServerHandle` with `url` and `close`.
- The server responds to HTTP requests on the configured port.
- `close()` resolves after all resources are cleaned up.
- Starting on an occupied port rejects with a descriptive error.
