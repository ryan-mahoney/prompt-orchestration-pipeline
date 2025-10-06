# Design & Cross-Step Contracts (Read First)

## Language & Module Conventions

- **Language:** Functional JavaScript, no classes.
- **Runtime:** Node 20+ for server/tests; React for UI tests (jsdom).
- **Modules:**
  - **CommonJS** for any modules the tests import via `require(...)` (e.g., `src/api`, server/orchestrator starters, test utilities).
  - ESM is fine elsewhere if your tooling supports it, but ensure interop where tests `require(...)`.

## Filesystem Contracts

- **Base data dir:** Resolved once and passed into server/orchestrator in tests.
- **Directories:**
  - `pipeline-data/pending/`
  - `pipeline-data/current/{name}/`
  - `pipeline-data/complete/` (if used by your orchestrator; not required by tests)

- **File names:**
  - **Pending file:** `pipeline-data/pending/{name}-seed.json`
  - **Current seed:** `pipeline-data/current/{name}/seed.json`

- **Atomic write:** Write to a temp file in `pending/`, then rename to `{name}-seed.json` to avoid partials.
- **Cleanup on failure:** If any error occurs after a partial write, remove the partial and leave no orphaned files.

## API Contracts

- **Endpoint:** `POST /api/upload/seed`
- **Request:** `multipart/form-data` with field name **`file`** containing the seed JSON.
- **Seed JSON required fields:**
  - `name` (string, non-empty, alphanumeric plus `-`/`_` allowed)
  - `data` (object)

- **Duplicate detection:** Reject if a job with the same `name` exists in **pending** (by file), **current** (by directory), or **complete** (if applicable).
- **Success response (HTTP 200):**
  - `{ success: true, jobName: "<name>", message: "Seed file uploaded successfully" }`

- **Error response (HTTP 400):**
  - `{ success: false, message: "<reason>" }`
  - The `<reason>` must include one of these exact substrings when applicable:
    - `"Invalid JSON"` (bad JSON)
    - `"required"` (missing fields)
    - `"already exists"` (duplicate)

## SSE Contracts

- **Endpoint:** `GET /api/events`
- **Event on success:** An event object with:
  - `type: "seed:uploaded"`
  - `data: { jobName: "<name>" }`

- **Stream requirements:** Standard `text/event-stream`, keep-alive; events broadcast to all connected clients.

## UI Contracts

- **Dashboard renders a labeled section:** Visible text **“Upload Seed File”**.
- **Stable test IDs:**
  - Upload container: `data-testid="upload-seed"`
  - Drop area: `data-testid="upload-area"`
  - File input: `data-testid="file-input"`

- **Connection state & disabling:**
  - Dashboard accepts **`isConnected`** prop (boolean).
  - When false, the upload area must have a **`disabled`** class and be inert for interactions.
  - If a hook (e.g., `useSSEConnection`) exists, the prop explicitly **overrides** it.

- **Success message:**
  - Includes the **job name** and the phrase **“created successfully”**.
  - Auto-clears after **exactly 5000 ms**.
  - Emits **`console.log("Seed uploaded:", "<jobName>")`** on success.

## Public APIs for Tests

- **Server starter:** `startServer({ dataDir, port? }) -> Promise<{ url, close }>`
- **Orchestrator starter:** `startOrchestrator({ dataDir, autoStart? }) -> Promise<{ stop }>`
- **Business API export:** `submitJob` exported from `src/api` (so tests can spy/replace).
- **Temp dir helper:** `createTempPipelineDir() -> Promise<string>` returning a ready structure under a temporary root.

## Test Environment Requirements

- **React tests:** jsdom + @testing-library/react + @testing-library/user-event.
- **E2E tests:** `fetch`, `FormData`, `Blob` must exist (Node 20’s `undici` covers these).
  - Provide `File` and `EventSource` if your environment lacks them (polyfill or test helper).

- **Fake timers:** Tests expect message auto-clear after **5000 ms** using fake timers.
- **Filesystem helpers:** Use `fs-extra` or replicate `pathExists` behavior consistently across tests and implementation.

---

# Step-by-Step Plan (Discreet, Testable Tasks)

## Step 1 — Establish Paths & Validation Utilities

**Files**

- `src/config/paths.js`
- `src/api/validators/seed.js`

**Do**

- Define and export functions to resolve `pending/`, `current/`, `complete/` paths **from a provided base directory**.
- Provide a single function that returns the **exact pending filename** for a given job name.
- Implement pure validation utilities for:
  - JSON validity (surface `"Invalid JSON"` on parse failure).
  - Required fields (`name`, `data`) with error including `"required"`.
  - Name format (alphanumeric + `-`/`_`).

- Implement a pure duplicate-check function that checks **pending/current/complete** for the provided `name` and surfaces an error including `"already exists"`.

**Test**

- Unit-test the utilities (paths resolution, name → filename mapping, validation decisions, duplicate detection against a temp directory tree).

---

## Step 2 — Server Upload Route (HTTP Layer)

**Files**

- `src/ui/server.js` (HTTP)
- `src/api/index.js` (business logic entry)
- `src/api/files.js` (atomic write + cleanup helpers)

**Do**

- In `server.js`, define `POST /api/upload/seed` that:
  - Parses a multipart request and extracts the file under field **`file`**.
  - Delegates to a business function **without** embedding logic in the HTTP layer.
  - Returns the **exact** success or error shapes specified in **API Contracts**.

- In `src/api/files.js`, provide pure functions for:
  - Atomic write in `pending/` using a temp path then rename.
  - Cleanup on any failure where a partial exists.

- In `src/api/index.js`, export:
  - `submitJob({ dataDir, seedObject })` used by the server to validate, detect duplicates, write to `pending/`, and return `{ success, jobName, message }`.

**Test**

- API tests that exercise `POST /api/upload/seed` with:
  - Valid seed → 200 with `{ success: true, jobName }` and the file written in **exact location**/name.
  - Invalid JSON → 400 with `"Invalid JSON"`.
  - Missing fields → 400 with `"required"`.
  - Duplicate → 400 with `"already exists"`.

- Verify cleanup: intentionally raise an error after the write step and assert no orphaned files remain.

---

## Step 3 — SSE Server (Event Stream)

**Files**

- `src/ui/sse.js`
- `src/ui/server.js` (wire-up)

**Do**

- Implement a functional SSE registry that:
  - Adds/removes clients on `GET /api/events`.
  - Exposes a `broadcast(eventObject)` function for other modules to call.

- In the upload success path (server or `submitJob` caller), **broadcast** exactly:
  `{ type: "seed:uploaded", jobName: "<name>" }`
- Ensure standard headers for SSE and keep-alive; broadcasting must reach all current clients.

**Test**

- Server SSE test:
  - Open an SSE connection to `/api/events`.
  - Perform a successful upload.
  - Assert receipt of an event where `type === "seed:uploaded"` and `jobName` matches.

---

## Step 4 — Orchestrator Pickup Semantics

**Files**

- `src/core/orchestrator.js`
- `src/core/pipeline-runner.js` (no changes unless required)
- `src/config/paths.js` (reuse)

**Do**

- Ensure the orchestrator:
  - Watches `pending/` and, upon detecting `{name}-seed.json`, creates `current/{name}/` and writes `seed.json` there.
  - Removes the original `pending` file once `current/{name}/seed.json` exists.
  - Handles multiple distinct names concurrently without races producing duplicates.

- Export **`startOrchestrator({ dataDir, autoStart? }) -> { stop }`**.

**Test**

- Orchestrator integration tests:
  - After uploading, assert `current/{name}/seed.json` exists with expected content and the `pending` file is gone.
  - Upload several distinct names concurrently and verify each proceeds independently.

---

## Step 5 — Server Starter API

**Files**

- `src/ui/server.js`

**Do**

- Export **`startServer({ dataDir, port? }) -> Promise<{ url, close }>`** where:
  - `url` points at the bound host (used by tests).
  - `close` gracefully shuts down the HTTP server and SSE registry.

**Test**

- In server tests (or E2E), start the server with a temp data dir, hit the endpoints, and close it. Verify no port leaks and that SSE stops cleanly.

---

## Step 6 — UI: Upload Component Contracts

**Files**

- `src/ui/client/components/UploadSeed.jsx`
- `src/ui/client/components/PromptPipelineDashboard.jsx`
- `src/ui/client/hooks/useSSEConnection.js` (if used)
- `src/ui/client/styles/upload.css` or Tailwind layer

**Do**

- In **`PromptPipelineDashboard.jsx`**:
  - Render visible label **“Upload Seed File”**.
  - Render an upload section with test IDs: `upload-seed`, `upload-area`, `file-input`.
  - Accept **`isConnected`** prop. If explicitly provided, it **overrides** any hook value.
  - Pass a boolean `disabled` prop to `UploadSeed` derived from connection state.
  - Display a success message containing the job name and **“created successfully”**.
  - Auto-clear the success message after **exactly 5000 ms** using a timer stored in component state.

- In **`UploadSeed.jsx`**:
  - Render a drop area and a file input (`data-testid="file-input"`).
  - If `disabled` is true:
    - Add the **`disabled`** class to the drop area (`data-testid="upload-area"`).
    - Prevent user actions from initiating uploads.

  - On successful upload:
    - Call a provided callback with `{ jobName }`.
    - Emit **`console.log("Seed uploaded:", jobName)`** (exact string and argument shape).

**Test**

- `tests/dashboard-integration.test.jsx`:
  - Upload area and label render; test IDs present.
  - Disabled class present when `isConnected={false}`.
  - On success: success UI includes `"created successfully"` and job name; log is emitted with exact text; message auto-clears after advancing fake timers **5000 ms**.

---

## Step 7 — Test Utilities for E2E

**Files**

- `tests/utils/createTempPipelineDir.js`
- `tests/utils/startServer.js`
- `tests/utils/startOrchestrator.js`
- `tests/utils/env.js` (polyfills/setup)

**Do**

- **`createTempPipelineDir`**: Create a temp root with `pending/`, `current/`, `complete/`.
- **`startServer`**: Launch server with a temp `dataDir`, return `{ url, close }`.
- **`startOrchestrator`**: Launch orchestrator with the same `dataDir`, return `{ stop }`.
- **`env.js`**: Ensure `fetch`, `FormData`, `Blob`, **`File`**, **`EventSource`** exist in the E2E environment. Configure fake timers for tests that use them.

**Test**

- E2E test bootstraps using these utilities and tears down cleanly (no residue dirs, ports, or watchers).

---

## Step 8 — End-to-End Test Alignment

**Files**

- `tests/e2e-upload.test.js`

**Do**

- Ensure the provided E2E test scenarios map 1:1 to the implemented contracts:
  1. Valid upload → 200, `success: true`, pending file exists with content, orchestrator creates `current/{name}/`, pending removed.
  2. Multiple concurrent uploads → all succeed, pending/count checks validate behavior.
  3. SSE broadcast on upload → `seed:uploaded` with correct `jobName`.
  4. Error cases: invalid JSON, missing fields, duplicate names → 400 with required substrings in messages.
  5. Cleanup on failure after write → no orphaned files under `pending/`.

**Test**

- Run E2E suite and confirm all cases assert the exact strings, paths, and event shapes specified earlier.

---

## Step 9 — Documentation (Contracts Only)

**Files**

- `README.md`
- `docs/upload.md`

**Do**

- `README.md`: Describe the feature at a high level and link to `docs/upload.md`. Include the **contracts** only (endpoint name, required fields, event type/payload, filenames/paths). No browser instructions or deployment sections.
- `docs/upload.md`:
  - API contract (endpoint, request field name, success/error response shapes and **exact** substrings).
  - SSE contract (endpoint, event shape).
  - Filesystem contract (paths, names, transitions).
  - Known limitations (e.g., no auth/rate limiting if that’s current reality).

**Test**

- Manually verify that docs match the implementation and tests (endpoint name, error messages, event name/payload, file paths).

---

# Traceability: Tests ↔ Contracts

- **Dashboard integration test**
  - Label text, test IDs, disabled class → **UI Contracts** & **Step 6**
  - Success message includes `"created successfully"` + job name, clears in **5000 ms** → **Design Contracts** & **Step 6**
  - Console log exact string → **UI Contracts**

- **E2E upload test**
  - 200 success + pending write → **API Contracts** & **Step 2**
  - Orchestrator pickup + removal from pending → **Filesystem Contracts** & **Step 4**
  - SSE broadcast with `type: "seed:uploaded"` and `jobName` → **SSE Contracts** & **Step 3**
  - Errors with required substrings → **API Contracts**
  - No orphaned files on failure → **Filesystem Contracts** & **Step 2**

---

# Final Acceptance Checklist

- [ ] **Exact strings**: “Upload Seed File”, “created successfully”, “Invalid JSON”, “required”, “already exists”, `console.log("Seed uploaded:", jobName)`.
- [ ] **Exact timeouts**: success message clears after **5000 ms** with fake timers supported.
- [ ] **Exact endpoints**: `POST /api/upload/seed`, `GET /api/events`.
- [ ] **Exact event shape**: `{ type: "seed:uploaded", data: { jobName } }`.
- [ ] **Exact filenames/paths**: `pending/{name}-seed.json`, `current/{name}/seed.json`.
- [ ] **Exports**:
  - `startServer({ dataDir, port? }) -> { url, close }`
  - `startOrchestrator({ dataDir, autoStart? }) -> { stop }`
  - `submitJob` from `src/api`
  - `createTempPipelineDir()`

- [ ] **No classes**: all modules expose **functional** APIs.
- [ ] **Test env ready**: jsdom, testing-library, fake timers, fetch/FormData/Blob/File/EventSource available.
- [ ] **Atomic writes + cleanup** implemented and verified.
- [ ] **Duplicate detection** checks pending/current/complete consistently.
