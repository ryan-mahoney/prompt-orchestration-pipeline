# Issue 1

## Cause: did not analyze package.json

How do we resolve this issue:

bun run demo:all
$ NODE_ENV=development PO_ROOT=demo bun run ui:build && concurrently "bun:demo:ui" "bun:demo:orchestrator" --kill-others-on-fail
$ vite build && bun run generate:embedded-assets
vite v7.3.1 building client environment for production...
✓ 0 modules transformed.
✗ Build failed in 6ms
error during build:
Could not resolve entry module "src/ui/client/index.html".
at getRollupError (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/parseAst.js:402:41)
at error (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/parseAst.js:398:42)
at ModuleLoader.loadEntryModule (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:21731:20)
at async Promise.all (index 0)
error: script "ui:build" exited with code 1
error: script "demo:all" exited with code 1

# Issue 2

## Cause: did not analyze package.json

How do we resolve this issue:

bun run demo:all
$ NODE_ENV=development PO_ROOT=demo bun run ui:build && concurrently "bun:demo:ui" "bun:demo:orchestrator" --kill-others-on-fail
$ vite build && bun run generate:embedded-assets
vite v7.3.1 building client environment for production...
✓ 1 modules transformed.
✗ Build failed in 82ms
error during build:
[vite:build-html] src/ui/client/main.tsx (19:2): Expected a semicolon (Note that you need plugins to import files that are not JavaScript)
file: /Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/ui/client/main.tsx:19:2 (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/ui/client/index.html)

17: "/pipelines/:slug",
18: "/code",
19: ] as const;
^
20:
21: export function App() {

    at getRollupError (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/parseAst.js:402:41)
    at ParseError.initialise (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:14465:28)
    at convertNode (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:16437:10)
    at convertProgram (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:15677:12)
    at Module.setSource (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:17392:24)
    at async ModuleLoader.addModuleSource (file:///Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules/rollup/dist/es/shared/node-entry.js:21497:13)

error: script "ui:build" exited with code 1
error: script "demo:all" exited with code 1

# Issue 3

## Cause: did not analyze package.json

How do we resolve this issue:

bun run demo:all
$ NODE_ENV=development PO_ROOT=demo bun run ui:build && concurrently "bun:demo:ui" "bun:demo:orchestrator" --kill-others-on-fail
$ vite build && bun run generate:embedded-assets
vite v7.3.1 building client environment for production...
✓ 3595 modules transformed.
../dist/index.html 0.74 kB │ gzip: 0.41 kB
../dist/assets/index-G4J9gcK0.js 3,375.08 kB │ gzip: 752.13 kB │ map: 5,983.07 kB
✓ built in 2.65s
$ bun scripts/generate-embedded-assets.js
Generated /Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/ui/embedded-assets.js with 3 assets
[demo:ui] $ NODE_ENV=production PO_ROOT=demo bun src/ui/server.js
[demo:orchestrator] $ PO_ROOT=demo NODE_ENV=production bun -e "import('./src/core/orchestrator.js').then(m => m.startOrchestrator({ dataDir: process.env.PO_ROOT || 'demo' })).catch(err => { console.error(err); process.exit(1) })"
[demo:ui] error: Module not found "src/ui/server.js"
[demo:ui] error: script "demo:ui" exited with code 1
[demo:ui] bun run demo:ui exited with code 1
--> Sending SIGTERM to other processes..
[demo:orchestrator] error: script "demo:orchestrator" was terminated by signal SIGTERM (Polite quit request)
[demo:orchestrator] bun run demo:orchestrator exited with code SIGTERM
error: script "demo:all" exited with code 1

# Issue 4

## Cause: did not analyze package.json

How do we resolve this issue:

bun run demo:all
$ NODE_ENV=development PO_ROOT=demo bun run ui:build && concurrently "bun:demo:ui" "bun:demo:orchestrator" --kill-others-on-fail
$ vite build && bun run generate:embedded-assets
vite v7.3.1 building client environment for production...
✓ 3595 modules transformed.
../dist/index.html 0.74 kB │ gzip: 0.41 kB
../dist/assets/index-G4J9gcK0.js 3,375.08 kB │ gzip: 752.13 kB │ map: 5,983.07 kB
✓ built in 2.57s
$ bun scripts/generate-embedded-assets.js
Generated /Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/ui/embedded-assets.js with 3 assets
[demo:ui] $ NODE_ENV=production PO_ROOT=demo bun src/ui/server/index.ts
[demo:orchestrator] $ PO_ROOT=demo NODE_ENV=production bun -e "import('./src/core/orchestrator.ts').then(m => m.startOrchestrator({ dataDir: process.env.PO_ROOT || 'demo' })).catch(err => { console.error(err); process.exit(1) })"
[demo:ui] bun run demo:ui exited with code 0

# Issue 5

## Cause: not sure

How do we resolve this fronrend rouring issue:

{"ok":false,"code":"NOT_FOUND","message":"route not found"}

# Issue 6

## Cause: didn't migrate build process fully

It looks like Tailwind is not getting built in the main output

# Issue 7

## Cause: spec error on upload directory target

A seed was uploaded (demo/pipeline-data/current/job-1772461820800/seed.json) but the task-status.json is empty: demo/pipeline-data/current/job-1772461820800/tasks-status.json

What is the root cause?

# Issue 8

## Cause: small issue

There is a hover state that is making buttons white

# Issue 9

How to we resolve this issue processing a newly uploaded seed:

demo:orchestrator] [orchestrator] status-initializer unavailable or failed for job job-1772462268611; proceeding with base status
[demo:orchestrator] [status-writer|job-1772462268611] [SSE:state:change] {
[demo:orchestrator] path: "demo/pipeline-data/current/job-1772462268611/tasks-status.json",
[demo:orchestrator] id: "job-1772462268611",
[demo:orchestrator] jobId: "job-1772462268611",
[demo:orchestrator] }
[demo:orchestrator] Unhandled error in runPipelineJob: 13 | fileUrl = modulePath;
[demo:orchestrator] 14 | } else if (modulePath.startsWith("/")) {
[demo:orchestrator] 15 | filePath = modulePath;
[demo:orchestrator] 16 | fileUrl = "file://" + modulePath;
[demo:orchestrator] 17 | } else {
[demo:orchestrator] 18 | throw new Error("Module path must be absolute");
[demo:orchestrator] ^
[demo:orchestrator] error: Module path must be absolute
[demo:orchestrator] at loadFreshModule (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/core/module-loader.ts:18:17)
[demo:orchestrator] at loadTaskRegistry (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/core/pipeline-runner.ts:253:21)
[demo:orchestrator] at runPipelineJob (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/core/pipeline-runner.ts:269:30)
[demo:orchestrator] at async handleRunJob (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/cli/index.ts:406:9)
[demo:orchestrator] at async <anonymous> (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/cli/index.ts:491:11)

# Issue 10

[demo:orchestrator] [orchestrator] status-initializer unavailable or failed for job job-1772462729636; proceeding with base status
[demo:orchestrator] [status-writer|job-1772462729636] [SSE:state:change] {
[demo:orchestrator] path: "/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/demo/pipeline-data/current/job-1772462729636/tasks-status.json",
[demo:orchestrator] id: "job-1772462729636",
[demo:orchestrator] jobId: "job-1772462729636",
[demo:orchestrator] }
[demo:orchestrator] [status-writer|job-1772462729636] [SSE:state:change] {
[demo:orchestrator] path: "/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/demo/pipeline-data/current/job-1772462729636/tasks-status.json",
[demo:orchestrator] id: "job-1772462729636",
[demo:orchestrator] jobId: "job-1772462729636",
[demo:orchestrator] }
[demo:orchestrator] [dotenv@17.3.1] injecting env (6) from .env -- tip: ⚙️ override existing env vars with { override: true }
[demo:orchestrator] 122 | const message =
[demo:orchestrator] 123 | errorBody && typeof errorBody === "object" && "message" in errorBody
[demo:orchestrator] 124 | ? String((errorBody as { message: unknown }).message)
[demo:orchestrator] 125 | : fallbackMessage;
[demo:orchestrator] 126 |
[demo:orchestrator] 127 | const error = new Error(message) as ProviderError;
[demo:orchestrator] ^
[demo:orchestrator] error: Moonshot API error: 400
[demo:orchestrator] status: 400,
[demo:orchestrator] details: {
[demo:orchestrator] error: [Object ...],
[demo:orchestrator] },
[demo:orchestrator] code: "HTTP_400"
[demo:orchestrator]
[demo:orchestrator] at createProviderError (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/providers/base.ts:127:21)
[demo:orchestrator] at moonshotChat (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/providers/moonshot.ts:109:21)
[demo:orchestrator]
[demo:orchestrator] Bun v1.3.8 (macOS arm64)
[demo:orchestrator] [orchestrator] job job-1772462729636 exited {
[demo:orchestrator] code: 1,
[demo:orchestrator] signal: null,
[demo:orchestrator] completionType: "failure",
[demo:orchestrator] }

# Issue 11

I do not see all of the tasks in the tasks in the demo/pipeline-data/current/job-1772462729636/tasks-status.json

I also do not see tasks in the DAG on /pipeline/job-1772462729636

# Issue 12

I expected demo/pipeline-data/current/job-1772462729636/research to be nested under "tasks" and to contain a symlink \_task_root -> /Users/ryanmahoney/Documents/prompt-orchestration-pipeline/demo/pipeline-config/content-generation/tasks and a symlink to node_modules -> /Users/ryanmahoney/Documents/prompt-orchestration-pipeline/node_modules

# Issue 13

We are getting this moonshot error, see @src-legacy/providers/moonshot.js for reference:

emo:orchestrator] [dotenv@17.3.1] injecting env (6) from .env -- tip: ⚙️ enable debug logging with { debug: true }
[demo:orchestrator] 122 | const message =
[demo:orchestrator] 123 | errorBody && typeof errorBody === "object" && "message" in errorBody
[demo:orchestrator] 124 | ? String((errorBody as { message: unknown }).message)
[demo:orchestrator] 125 | : fallbackMessage;
[demo:orchestrator] 126 |
[demo:orchestrator] 127 | const error = new Error(message) as ProviderError;
[demo:orchestrator] ^
[demo:orchestrator] error: Moonshot API error: 400
[demo:orchestrator] status: 400,
[demo:orchestrator] details: {
[demo:orchestrator] error: [Object ...],
[demo:orchestrator] },
[demo:orchestrator] code: "HTTP_400"

# Issue 14

## Cause lack of clarity of intent on maintaining existing design

the Dag in [DAGGrid.tsx](src/ui/components/DAGGrid.tsx) looks and works very different than [DAGGrid.jsx](react-legacy/components/DAGGrid.jsx)

How can we bring the TS version up to the same state as the original?

# Issue 15

As the pipeline runs, new files are written to the job's files folder. They are not auto-appearing on the page /pipeline/job-1772463590883

# Issue 16

On the /pipeline/job-1772465145063 page this error appears on the console:

GET http://localhost:4000/api/events?jobId=job-1772465145063 net::ERR_INCOMPLETE_CHUNKED_ENCODING 200 (OK)

# Issue 17

emo:orchestrator] error: Invalid request: messages must not be empty
[demo:orchestrator] status: 400,
[demo:orchestrator] details: {
[demo:orchestrator] error: [Object ...],
[demo:orchestrator] },
[demo:orchestrator] code: "HTTP_400"
[demo:orchestrator]
[demo:orchestrator] at createProviderError (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/providers/base.ts:148:21)
[demo:orchestrator] at moonshotChat (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/providers/moonshot.ts:110:21)
[demo:orchestrator]
[demo:orchestrator] Bun v1.3.8 (macOS arm64)
[demo:orchestrator] [orchestrator] job job-1772465145063 exited {
[demo:orchestrator] code: 1,
[demo:orchestrator] signal: null,
[demo:orchestrator] completionType: "failure",
[demo:orchestrator] }

# Issue 18

[demo:ui] [ui-server] request failed {
[demo:ui] name: "Error",
[demo:ui] message: "ENOENT: no such file or directory, open 'demo/pipeline-data/current/job-1772466999702/tasks/research/files/artifacts/research-output.json'",
[demo:ui] stack: undefined,
[demo:ui] component: "ui-server",
[demo:ui] timestamp: "2026-03-02T15:57:41.183Z",
[demo:ui] }

# Issue 19

Evanluate this error:

Error: Schema validation failed: undefined
at <anonymous> (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/demo/pipeline-config/content-generation/tasks/research.js:214:15)
at async runPipeline (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/core/task-runner.ts:644:34)
at async runPipelineJob (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/core/pipeline-runner.ts:416:26)
at async handleRunJob (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/cli/index.ts:406:9)
at async <anonymous> (/Users/ryanmahoney/Documents/prompt-orchestration-pipeline/src/cli/index.ts:491:11)
at processTicksAndRejections (native:7:39)

# Issue 20

/api/jobs/job-1772466999702/restart does not appear to restart the pipeline

# Issue 21

Not seeing tasks on /pipelines/content-generation

# Issue 22

Review and start fixing failing tests by running: npm tun test
