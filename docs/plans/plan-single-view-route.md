# Problem analysis

- JobDetail received pipeline=null from PromptPipelineDashboard, which never set pipeline.
- selectedJob is adapted via adaptJobSummary, which returns tasks as an array, but JobDetail assumed an object map keyed by task id/name.
- Combined issues caused DAG to render with weak metadata or empty content, appearing “mostly blank” with demo data.

# Proposed outcome (new architecture, no backwards compatibility)

- Single-job route: /pipeline/:jobId renders a dedicated PipelineDetail page.
- Initial load: page fetches the job detail and the pipeline.tasks (canonical order) via API, builds page state, and renders JobDetail.
- Live updates: page then subscribes to SSE scoped to that job only, applying incremental updates idempotently.
- Random jobId: seed uploads create jobs with a randomly generated jobId; filesystem directories are named by jobId, not by seed name.
- Normalization: JobDetail and DAG utilities handle job.tasks shaped as either array or object; pipeline order is respected for DAG rendering.

# User acceptance criteria

Routing and page initialization

- /pipeline/:jobId route exists and renders a PipelineDetail page for the given jobId.

- On first load:
  - Page fetches GET /api/jobs/:jobId returning a detail-shaped job with tasks (array) and pipeline.tasks (canonical task list).
  - Page renders JobDetail with non-empty DAG cards (titles, statuses, subtitles when available).

SSE behavior (scoped to job)

- Client connects to /api/events?jobId=:jobId.
- Only events for that jobId update the page; other jobs’ events are ignored.
- Connection status reflects connected/disconnected accurately; no console errors for normal retries.

Job creation and identifiers

- POST /api/upload/seed returns { success, jobId, jobName } with jobId randomly generated (not derived from seed text).
- Filesystem persists data using jobId-based folder names.
- After creation, navigation to /pipeline/:jobId shows the job’s detail view with pipeline and tasks loaded.

Pipeline and DAG rendering

- pipeline.tasks is provided by the server for the job (snapshot at creation time).
- DAG ordering follows pipeline.tasks exactly; extra tasks not in pipeline appear after canonical tasks.
- Active index logic: first active, else first error, else last succeeded, else index 0.
- Subtitles display when available: model, temperature, attempts, refinements, execution time.
- Cards are not blank for the provided demo data; states map correctly (pending/running/done/error → pending/active/succeeded/error).

Task shape normalization

- If job.tasks is an array, JobDetail normalizes to a lookup by t.name for internal use.
- If job.tasks is an object map, it works without additional conversion.
- computeDagItems accepts either shape and uses pipeline order as canonical.

Error handling and UX

- If GET /api/jobs/:jobId fails, page shows a neutral, informative error state (no fallback to in-memory demo arrays).

- Slide-over for DAG items:
  - Keyboard accessible (Enter/Space to open, Escape to close).
  - Focus managed to the close button when opened.
  - File list interactions do not throw errors.

Testing validation

- Server SSE filtering: /api/events?jobId emits only that job’s events to the client.
- Upload and paths: seed upload returns random jobId and writes id-based directories.
- Job detail API: returns pipeline.tasks and tasks array; no dependency on seed name for identity.
- DAG mapping: array/object task shapes render consistently in canonical order; state mapping correct.
- Client hook: hydrates from API then applies scoped SSE updates deterministically.

Performance and data flow

- Initial bootstrap uses HTTP (GET /api/jobs/:jobId), not SSE.
- SSE is incremental and compact; no full-state dump over SSE.
- Event queueing before hydration is supported; applied deterministically after hydrate.

Non-goals

- No backward compatibility with name-based directories or legacy assumptions; jobId is the sole identifier going forward.

# STEP BY STEP Implementation

Step 1 — Create single-job route and page shell

- Add /pipeline/:jobId route in client router (src/ui/client/main.jsx).
- Create src/pages/PipelineDetail.jsx with a minimal page that:
  - Reads jobId from route params.
  - Fetches GET /api/jobs/:jobId on mount (no SSE yet).
  - Renders JobDetail with the fetched job and a temporary derived pipeline: if no pipeline is present, derive tasks list from job.tasks (array → names, object → keys).

Step 2 — Normalize JobDetail to accept array or object tasks

- Update src/components/JobDetail.jsx:
  - If Array.isArray(job.tasks), build taskById = Object.fromEntries(tasks.map(t => [t.name, t])).
  - Compute pipelineTasks = pipeline?.tasks ?? (Array.isArray(job.tasks) ? job.tasks.map(t => t.name) : Object.keys(job.tasks || {})).
  - Ensure computeDagItems receives the above pipelineTasks (via pipeline object).
- Update src/utils/dag.js to handle array-based tasks when job.tasks is an array (use t.name as id).

Step 3 — Link dashboard to the new route

- Update src/pages/PromptPipelineDashboard.jsx and src/components/JobTable.jsx:
  - Remove inline JobDetail rendering.
  - On row click, navigate to /pipeline/:jobId (use the job.id from adaptJobSummary).
  - Remove pipeline state from dashboard.

Step 4 — Include pipeline tasks with job detail

- Update /api/jobs/:jobId (src/ui/endpoints/job-endpoints.js) to return:
  - { id, name, status, progress, createdAt, updatedAt, tasks (array), pipeline: { tasks: [...] } }.
- For now, read canonical task list from demo/pipeline-config/pipeline.json and attach as pipeline.tasks.

Step 5 — Client hook for detail + SSE (client-side filter first)

- Add src/ui/client/hooks/useJobDetailWithUpdates.js:
  - On mount: fetch /api/jobs/:jobId (detail), set local state, mark hydrated.
  - Subscribe to /api/events (no query yet). When events arrive:
    - Parse event payload; if payload.id !== jobId, ignore.
    - Reduce into local job state (applyJobEvent-like reducer).
  - Return { data, loading, error, connectionStatus }.
- Use this hook in PipelineDetail.jsx to power JobDetail.

Step 6 — Server-side SSE filtering by jobId

- Update src/ui/server.js:
  - Parse ?jobId from /api/events query string.
  - sseRegistry.addClient(res, { jobId }).
- Update src/ui/sse.js (registry):
  - Store { res, jobId } per client.
  - broadcast({ type, data }):
    - If data?.id exists and client.jobId is set, only write to clients where data.id === client.jobId.
    - If client.jobId is not set, write all events (keeps behavior sane for future pages).
- Update client hook useJobDetailWithUpdates.js to connect to /api/events?jobId=:jobId.

Step 7 — Random jobId generation and ID-based filesystem layout

- Update POST /api/upload/seed (src/ui/server.js → handleSeedUpload + src/api/index.js):
  - Generate random jobId (e.g., nanoid/uuid).
  - Write pending/current using jobId as directory name (not seed name).
  - Include a job metadata file under the job folder (e.g., job.json) containing { id, name, pipelineName, createdAt, ... }.
  - Store a snapshot of pipeline config used at creation time into job dir (pipeline.json).
  - Response returns { success, jobId, jobName }.
- Update src/config/paths.js to resolve by jobId only (drop name-based helpers).
- Update src/ui/job-scanner.js and src/ui/job-reader.js to enumerate/read by jobId directories.
- Update all transforms so /api/jobs and /api/jobs/:id use id consistently.

Step 8 — Detail API uses per-job pipeline snapshot

- Change /api/jobs/:jobId to read pipeline.json in the job directory and include pipeline.tasks from that snapshot (stop reading global demo/pipeline-config).
- Remove any remaining assumptions about job name → directory.

Step 9 — Tighten adapters and DAG mapping

- Ensure adaptJobDetail returns tasks as an array with names and valid states.
- Ensure JobDetail receives a detail-shaped job (array tasks) and the pipeline from the API.
- Keep the internal normalization (array→map) defensive as a guardrail.

Step 10 — Tests and verification

- Add tests:
  - ui.server.routing.test.js: GET /api/events?jobId filters events to the specific job.
  - job-endpoints.integration.test.js: POST /api/upload/seed returns random jobId and writes id-based dirs; GET /api/jobs/:id includes pipeline snapshot.
  - dag-mapping.test.js: computeDagItems handles array/object and honors pipeline order.
  - useJobDetailWithUpdates.test.jsx: hydrates then applies SSE for that job only.
  - PromptPipelineDashboard.test.jsx: rows link to /pipeline/:jobId.
- Run npm -s test and manual verification:
  - Start dev server, create a new job via UploadSeed, auto-redirect to /pipeline/:jobId (optional follow-up).
  - Confirm DAG renders with correct order and metadata; SSE updates only affect this page.

Notes on removals (no backwards compatibility)

- Remove name-based directory assumptions.
- Do not support existing name-based demo folders; update demo seeding to produce id-based structure.
- Make /api/jobs and /api/jobs/:id authoritative on id everywhere.

Optional follow-ups (post-MVP)

- Add “Open in new tab” from dashboard rows.
- Replace node:fs usage in JobDetail.getFileContent with API to fetch artifacts (e.g., /api/jobs/:id/tasks/:taskId/files/:filename).

If you approve this sequence, toggle to Act mode and I’ll implement step-by-step with tests at each step.
