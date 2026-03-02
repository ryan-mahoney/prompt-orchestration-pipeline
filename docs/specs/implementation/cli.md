# Implementation Specification: `cli`

**Analysis source:** `docs/specs/analysis/cli.md`

---

## 1. Qualifications

- TypeScript strict mode (discriminated unions, `const` assertions, template literal types)
- Commander.js CLI framework (`Command` class, actions, options, argument parsing)
- Bun subprocess APIs (`Bun.spawn`) for self-reexec process coordination
- Bun file I/O (`Bun.file`, `Bun.write`) for scaffolding and workspace initialization
- POSIX signal handling (`SIGINT`, `SIGTERM`, `SIGKILL`) for coordinated child process lifecycle
- `import.meta` usage for deriving package root paths in ESM
- JSON file read-modify-write patterns (registry, pipeline config, task index)
- Process management patterns: supervisor, kill-others-on-fail, SIGKILL escalation timeout

---

## 2. Problem Statement

The system requires a multi-command CLI entry point that initializes workspaces, starts the orchestrator and UI server as co-managed child processes, submits jobs, queries status, scaffolds pipelines and tasks, and runs static task analysis. The existing JS implementation provides this via Commander.js with a self-reexec process model for child process isolation. This spec defines the TypeScript replacement.

---

## 3. Goal

A set of TypeScript modules under `src/cli/` that provide identical behavioral contracts to the analyzed JS CLI — command parsing and dispatch, workspace initialization, self-reexec process coordination, pipeline/task scaffolding, job submission and status querying, and static analysis invocation — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/cli/types.ts` | Shared types for CLI module: registry, pipeline config, reexec args, stage definitions. |
| `src/cli/constants.ts` | Canonical stage names, stage purpose descriptions, kebab-case validation regex. |
| `src/cli/self-reexec.ts` | `buildReexecArgs` and `isCompiledBinary` for self-reexec process model. |
| `src/cli/update-pipeline-json.ts` | `updatePipelineJson` helper for appending tasks to `pipeline.json`. |
| `src/cli/analyze-task.ts` | `analyzeTaskFile` helper for running static analysis and outputting JSON. |
| `src/cli/index.ts` | Main CLI entry point: Commander program definition, all command handlers, hidden subcommands. |

### Key types and interfaces

```typescript
// ── src/cli/types.ts ──

/** Central index of all pipelines in the workspace. */
interface Registry {
  pipelines: Record<string, PipelineRegistryEntry>;
}

/** A single pipeline's entry in the registry. */
interface PipelineRegistryEntry {
  name: string;
  description: string;
  pipelinePath: string;
  taskRegistryPath: string;
}

/** A pipeline's configuration file. */
interface PipelineConfig {
  name: string;
  version: string;
  description: string;
  tasks: string[];
}

/** Return value from buildReexecArgs. */
interface ReexecArgs {
  execPath: string;
  args: string[];
}

/** Task index: maps task slugs to relative module paths. */
type TaskIndex = Record<string, string>;
```

### Bun-specific design decisions

| Area | Change from JS Original | Rationale |
|------|------------------------|-----------|
| Child process spawning | Replace `node:child_process.spawn` with `Bun.spawn` | Native Bun subprocess API — typed, simpler stdio piping, no Node.js compat layer. |
| File I/O | Replace `node:fs/promises` with `Bun.file()` / `Bun.write()` for reading/writing registry, pipeline config, task files | Bun-native file I/O. |
| Directory creation | Use `import { mkdir } from "node:fs/promises"` (Bun supports it natively) | `mkdir` with `recursive: true` has no Bun-native equivalent; `node:fs/promises` is fully supported. |
| Compiled binary detection | Keep `/$bunfs/` check in `isCompiledBinary` | Bun's virtual filesystem path for standalone binaries. |
| Task index parsing | Replace `eval()` with regex-based parsing or `Bun.file().text()` + JSON-compatible extraction | Eliminates code injection risk flagged in analysis. No `eval()` in the TS version. |
| Shebang | `#!/usr/bin/env bun` | Bun runtime. |

### Dependency map

**Internal `src/` imports:**

| This module imports from | What |
|--------------------------|------|
| `src/api/index.ts` | `submitJobWithValidation`, `PipelineOrchestrator` (used by `submit` and `status` commands) |
| `src/ui/server.ts` | `startServer` (dynamic import in `_start-ui` handler) |
| `src/core/orchestrator.ts` | `startOrchestrator` (dynamic import in `_start-orchestrator` handler) |
| `src/core/pipeline-runner.ts` | `runPipelineJob` (dynamic import in `_run-job` handler) |
| `src/task-analysis/index.ts` | `analyzeTask` (dynamic import in `analyze-task.ts`) |
| `src/cli/update-pipeline-json.ts` | `updatePipelineJson` |
| `src/cli/analyze-task.ts` | `analyzeTaskFile` |
| `src/cli/self-reexec.ts` | `buildReexecArgs`, `isCompiledBinary` |
| `src/cli/constants.ts` | `STAGE_NAMES`, `getStagePurpose`, `KEBAB_CASE_REGEX` |
| `src/cli/types.ts` | All type imports |

**External packages:**

| Package | Used by | Purpose |
|---------|---------|---------|
| `commander` | `src/cli/index.ts` | CLI argument parsing and command routing |

---

## 5. Acceptance Criteria

### Core behavior

1. The CLI binary parses and dispatches commands (`init`, `start`, `submit`, `status`, `add-pipeline`, `add-pipeline-task`, `analyze`) to the correct handler.
2. Global `--root <path>` option is available on all commands that require it, defaulting to `./pipelines` (except `start`, which requires it or `PO_ROOT`).
3. Global `--port <port>` option is available and defaults to `"4000"`.
4. Hidden subcommands (`_start-ui`, `_start-orchestrator`, `_run-job`) are registered and functional but not listed in help output.

### `init` command

5. `init` creates the directory tree: `pipeline-config/`, `pipeline-data/pending/`, `pipeline-data/current/`, `pipeline-data/complete/`, `pipeline-data/rejected/` under the root, all with `recursive: true`.
6. `init` writes empty `.gitkeep` files in each `pipeline-data/` subdirectory.
7. `init` writes `registry.json` with content `{ "pipelines": {} }` (pretty-printed, trailing newline).
8. `init` is safe to re-run — directory creation is idempotent due to `recursive: true` (registry overwrite is intentional).

### `start` command

9. `start` exits with code 1 if neither `--root` nor `PO_ROOT` is provided.
10. `start` checks for `src/ui/dist` in source mode (non-compiled binary) and exits with code 1 if missing.
11. `start` spawns the UI server and orchestrator as child processes via `buildReexecArgs`, passing correct environment variables (`NODE_ENV=production`, `PO_ROOT`, `PORT`, `PO_UI_PORT=undefined`).
12. `start` pipes stdout/stderr from both children with `[ui]` and `[orc]` prefixes.
13. `start` implements kill-others-on-fail: if either child exits non-zero, the other is terminated.
14. `start` handles `SIGINT`/`SIGTERM` on the parent by sending `SIGTERM` to children, escalating to `SIGKILL` after 5 seconds.

### `submit` command

15. `submit <seed-file>` reads and parses the seed file as JSON, calls `submitJobWithValidation` with `{ dataDir: process.cwd(), seedObject }`.
16. `submit` logs `Job submitted: <jobId> (<jobName>)` on success.
17. `submit` exits with code 1 on JSON parse errors, file-not-found, or API failure (`success=false`).

### `status` command

18. `status [job-name]` creates a `PipelineOrchestrator` with `{ autoStart: false }`.
19. `status` with a job name calls `getStatus(jobName)` and outputs pretty-printed JSON.
20. `status` without a job name calls `listJobs()` and outputs a table via `console.table`.

### `add-pipeline` command

21. `add-pipeline <slug>` validates slug against `/^[a-z0-9-]+$/` and exits with code 1 on failure.
22. `add-pipeline` creates `<root>/pipeline-config/<slug>/tasks/` directory tree.
23. `add-pipeline` writes `pipeline.json` with `{ name, version: "1.0.0", description: "New pipeline", tasks: [] }`.
24. `add-pipeline` writes `tasks/index.ts` with `export default {};`.
25. `add-pipeline` reads existing `registry.json` (falling back to empty registry on failure), adds/replaces the pipeline entry, and writes back.

### `add-pipeline-task` command

26. `add-pipeline-task <pipeline-slug> <task-slug>` validates both slugs against kebab-case regex.
27. `add-pipeline-task` verifies the pipeline's `tasks/` directory exists.
28. `add-pipeline-task` generates a task file with exported function stubs for all 11 canonical stage names, where `ingestion` receives `data: { seed }` and other stages receive `data`.
29. `add-pipeline-task` updates `tasks/index.ts` by parsing the existing default export, adding the new task mapping, sorting keys alphabetically.
30. `add-pipeline-task` delegates to `updatePipelineJson` to append the task slug to the `tasks` array (idempotent — no duplicates).

### `analyze` command

31. `analyze <task-path>` reads the task file, calls `analyzeTask`, and outputs the result as pretty-printed JSON to stdout.
32. `analyze` exits with code 1 on file-not-found, showing full stack traces in development mode (`NODE_ENV=development` or `DEBUG_TASK_ANALYSIS=1`).

### Hidden subcommands

33. `_start-ui` dynamically imports `startServer` and calls it with `{ dataDir, port }` from environment variables.
34. `_start-orchestrator` validates `PO_ROOT`, dynamically imports `startOrchestrator`, calls it with `{ dataDir }`, and registers SIGINT/SIGTERM handlers that call `stop()`.
35. `_run-job <jobId>` dynamically imports `runPipelineJob` and calls it with the job ID.

### Self-reexec

36. `buildReexecArgs` returns `{ execPath: process.execPath, args: [...command] }` in compiled binary mode.
37. `buildReexecArgs` returns `{ execPath: process.execPath, args: [CLI_ENTRY, ...command] }` in source mode.
38. `isCompiledBinary` returns `true` if the current file path contains `/$bunfs/`, normalizing Windows backslashes.

### `updatePipelineJson`

39. `updatePipelineJson` reads `pipeline.json`, appends the task slug to the `tasks` array if not already present, and writes back.
40. `updatePipelineJson` creates a minimal config (`{ name, version: "1.0.0", description: "New pipeline", tasks: [] }`) if the file is missing or invalid.

### Error handling

41. Commands that can fail use try/catch with `console.error` and `process.exit(1)`.
42. `init` and `status` command handlers have no try/catch — errors propagate as unhandled rejections (matching JS behavior).

---

## 6. Notes

### Design trade-offs

- **`eval()` removal:** The JS original uses `eval()` to parse `tasks/index.js` default export. The TS version replaces this with regex-based extraction of key-value pairs from the export object literal. This eliminates the code injection risk while maintaining the same functionality. Trade-off: regex parsing is less flexible than `eval()` but sufficient for the controlled format of auto-generated index files.
- **Task index file extension:** The scaffolded task index and task files will use `.ts` extension in the TypeScript version. The generated stage stubs will include TypeScript type annotations.
- **Commander.js retention:** The analysis shows Commander usage is localized to `index.ts`. Retaining Commander avoids reinventing CLI parsing. If a lighter alternative is desired, it can be swapped later since the coupling is contained.

### Open questions from analysis

- **Stage names synchronization:** The `STAGE_NAMES` array must match the task runner's stages. The TS version exports `STAGE_NAMES` from `src/cli/constants.ts` as a shared constant. The task runner should import from here (or both should import from a shared config module). This spec defines the CLI's constant; the task runner spec should reference the same source of truth.
- **`init` overwriting registry:** Running `init` unconditionally writes `{ "pipelines": {} }`, destroying existing registrations. This behavior is preserved as-is since the analysis notes it may be intentional (full reset). A future enhancement could make `init` check for existing registry and skip the overwrite.
- **`status` command `PipelineOrchestrator.create` vs constructor:** The TS version should use whatever factory method/constructor the migrated `PipelineOrchestrator` exposes. This will depend on the API module's migration.
- **Port type:** The `--port` option defaults to `"4000"` (string). It's passed as `PORT` env var to the UI child. The hidden `_start-ui` handler parses it with `parseInt`. This string-to-number flow is preserved.

### Migration-specific concerns

- **Behaviors that change intentionally:**
  - `eval()` replaced with regex-based index parsing.
  - Scaffolded files use `.ts` extension instead of `.js`.
  - Generated stage function stubs include TypeScript type annotations for the `data` parameter.
- **Behaviors that must remain identical:**
  - All command names, options, arguments, and defaults.
  - Directory structure created by `init`.
  - `start` command self-reexec model and cleanup behavior.
  - Kill-others-on-fail and SIGKILL escalation timing (5 seconds).
  - Registry and pipeline config JSON formats.
  - Stage names and ordering.
  - Kebab-case validation regex.
  - Exit codes for all error scenarios.

### Dependencies on other modules

- **`src/api/index.ts`** must be available — `submit` and `status` commands import `submitJobWithValidation` and `PipelineOrchestrator`. If not yet migrated, stub with type-compatible shims.
- **`src/ui/server.ts`** must be available — `_start-ui` dynamically imports `startServer`. Can be stubbed.
- **`src/core/orchestrator.ts`** must be available — `_start-orchestrator` dynamically imports `startOrchestrator`. Can be stubbed.
- **`src/core/pipeline-runner.ts`** must be available — `_run-job` dynamically imports `runPipelineJob`. Can be stubbed.
- **`src/task-analysis/index.ts`** must be available — `analyze` command dynamically imports `analyzeTask`. Can be stubbed.

### Performance considerations

- `Bun.spawn` for child process management is expected to be faster than Node.js `child_process.spawn`.
- `Bun.file().text()` and `Bun.write()` for config file I/O are async and efficient.
- The CLI is a short-lived process (except `start`), so startup performance matters. Commander.js parsing adds minimal overhead.

---

## 7. Implementation Steps

### Step 1: Create CLI types

**What to do:** Create `src/cli/types.ts` with all interfaces defined in Section 4 (Architecture → Key types and interfaces): `Registry`, `PipelineRegistryEntry`, `PipelineConfig`, `ReexecArgs`, `TaskIndex`.

**Why:** All subsequent CLI modules import from this file. Types must exist first (ordering principle).

**Type signatures:**

```typescript
export interface Registry {
  pipelines: Record<string, PipelineRegistryEntry>;
}

export interface PipelineRegistryEntry {
  name: string;
  description: string;
  pipelinePath: string;
  taskRegistryPath: string;
}

export interface PipelineConfig {
  name: string;
  version: string;
  description: string;
  tasks: string[];
}

export interface ReexecArgs {
  execPath: string;
  args: string[];
}

export type TaskIndex = Record<string, string>;
```

**Test:** `src/cli/__tests__/types.test.ts` — Verify that the types can be imported and used to construct objects that satisfy the interfaces. Verify `Registry` with an empty `pipelines` object is valid. Verify `PipelineConfig` with all required fields is valid.

---

### Step 2: Create CLI constants

**What to do:** Create `src/cli/constants.ts` exporting `STAGE_NAMES` (frozen array of 11 canonical stage name strings), `getStagePurpose(stageName: string): string` (returns purpose description), and `KEBAB_CASE_REGEX` (`/^[a-z0-9-]+$/`).

**Why:** Stage names are used by `add-pipeline-task` for scaffolding. The kebab-case regex is used by `add-pipeline` and `add-pipeline-task` for slug validation. Satisfies acceptance criteria 26, 28.

**Type signatures:**

```typescript
export const STAGE_NAMES: readonly string[]
export function getStagePurpose(stageName: string): string
export const KEBAB_CASE_REGEX: RegExp
```

**Implementation details:**
- `STAGE_NAMES` = `["ingestion", "preProcessing", "promptTemplating", "inference", "parsing", "validateStructure", "validateQuality", "critique", "refine", "finalValidation", "integration"]` frozen with `as const`.
- `getStagePurpose` returns the human-readable purpose from a lookup map matching the analysis doc's stage purpose descriptions table.
- `KEBAB_CASE_REGEX` = `/^[a-z0-9-]+$/`.

**Test:** `src/cli/__tests__/constants.test.ts`
- Verify `STAGE_NAMES` has exactly 11 entries.
- Verify `STAGE_NAMES[0]` is `"ingestion"` and `STAGE_NAMES[10]` is `"integration"`.
- Verify `getStagePurpose("ingestion")` returns a non-empty string.
- Verify `getStagePurpose("unknown")` returns a non-empty fallback or empty string.
- Verify `KEBAB_CASE_REGEX.test("valid-slug")` is `true`.
- Verify `KEBAB_CASE_REGEX.test("Invalid_Slug")` is `false`.

---

### Step 3: Implement self-reexec utilities

**What to do:** Create `src/cli/self-reexec.ts` exporting `buildReexecArgs(command: string[]): ReexecArgs` and `isCompiledBinary(): boolean`.

**Why:** The `start` command and hidden subcommands depend on self-reexec for process isolation. Satisfies acceptance criteria 36, 37, 38.

**Type signatures:**

```typescript
export function buildReexecArgs(command: string[]): ReexecArgs
export function isCompiledBinary(): boolean
```

**Implementation details:**
- `isCompiledBinary`: Normalizes `import.meta.url` or `import.meta.path` by replacing backslashes with forward slashes, then checks for `/$bunfs/`.
- `buildReexecArgs`: In compiled mode, returns `{ execPath: process.execPath, args: [...command] }`. In source mode, resolves the CLI entry path from `import.meta.dir` (navigating to `src/cli/index.ts`) and returns `{ execPath: process.execPath, args: [cliEntryPath, ...command] }`.

**Test:** `src/cli/__tests__/self-reexec.test.ts`
- Verify `isCompiledBinary()` returns `false` when running from source (default test environment).
- Verify `buildReexecArgs(["_start-ui"])` returns an object with `execPath` equal to `process.execPath` and `args` containing `"_start-ui"`.
- Verify `buildReexecArgs(["_run-job", "abc-123"])` includes `"_run-job"` and `"abc-123"` in `args`.

---

### Step 4: Implement `updatePipelineJson`

**What to do:** Create `src/cli/update-pipeline-json.ts` exporting `updatePipelineJson(root: string, pipelineSlug: string, taskSlug: string): Promise<void>`.

**Why:** Used by `add-pipeline-task` to append tasks to `pipeline.json`. Satisfies acceptance criteria 39, 40.

**Type signatures:**

```typescript
export async function updatePipelineJson(
  root: string,
  pipelineSlug: string,
  taskSlug: string
): Promise<void>
```

**Implementation details:**
- Read `<root>/pipeline-config/<pipelineSlug>/pipeline.json` using `Bun.file().text()`.
- Parse as JSON into `PipelineConfig`. If reading or parsing fails, create a minimal config: `{ name: pipelineSlug, version: "1.0.0", description: "New pipeline", tasks: [] }`.
- Ensure `tasks` is an array (default to `[]` if not).
- Append `taskSlug` to `tasks` only if not already present (`tasks.includes(taskSlug)` check).
- Write back with `Bun.write` using `JSON.stringify(config, null, 2) + "\n"`.

**Test:** `src/cli/__tests__/update-pipeline-json.test.ts`
- Create a temp directory with a `pipeline.json` containing `{ "name": "test", "version": "1.0.0", "description": "Test", "tasks": ["a"] }`. Call `updatePipelineJson` with `taskSlug: "b"`. Verify the file now contains `["a", "b"]`.
- Call again with `taskSlug: "b"`. Verify no duplicate — still `["a", "b"]`.
- Test with missing `pipeline.json` — verify a minimal config is created with the task slug.

---

### Step 5: Implement `analyzeTaskFile`

**What to do:** Create `src/cli/analyze-task.ts` exporting `analyzeTaskFile(taskPath: string): Promise<void>`.

**Why:** Used by the `analyze` command to run static analysis on a task file. Satisfies acceptance criteria 31, 32.

**Type signatures:**

```typescript
export async function analyzeTaskFile(taskPath: string): Promise<void>
```

**Implementation details:**
- Resolve `taskPath` to an absolute path using `path.resolve`.
- Read the file using `Bun.file(absolutePath).text()`.
- On file-not-found (`ENOENT`), log the error and call `process.exit(1)`.
- Dynamically import `analyzeTask` from `../task-analysis/index.ts`.
- Call `analyzeTask(code, absolutePath)` and output the result as `JSON.stringify(result, null, 2)` to stdout.
- On error: in development mode (`NODE_ENV=development` or `DEBUG_TASK_ANALYSIS=1`), print full stack trace; in normal mode, print error message only. Exit with code 1.

**Test:** `src/cli/__tests__/analyze-task.test.ts`
- Mock `analyzeTask` to return a known result object. Write a temp task file. Call `analyzeTaskFile` and capture stdout. Verify JSON output matches the mock result.
- Call with a non-existent file path. Verify `process.exit(1)` is called (mock `process.exit`).

---

### Step 6: Implement the main CLI entry point

**What to do:** Create `src/cli/index.ts` with the full Commander program definition including all commands, options, hidden subcommands, and command handlers.

**Why:** This is the primary CLI entry point that wires everything together. Satisfies acceptance criteria 1–4, 5–8, 9–14, 15–17, 18–20, 21–25, 26–30, 33–35, 41–42.

**Type signatures:**

The CLI module does not export functions for external consumption (it is a runnable entry point). Internally it defines the following command handlers:

```typescript
// init handler
async function handleInit(root: string): Promise<void>

// start handler
async function handleStart(root: string | undefined, port: string): Promise<void>

// submit handler
async function handleSubmit(seedFile: string): Promise<void>

// status handler
async function handleStatus(jobName: string | undefined): Promise<void>

// add-pipeline handler
async function handleAddPipeline(slug: string, root: string): Promise<void>

// add-pipeline-task handler
async function handleAddPipelineTask(
  pipelineSlug: string,
  taskSlug: string,
  root: string
): Promise<void>

// analyze handler
async function handleAnalyze(taskPath: string): Promise<void>
```

**Implementation details:**

**`init` command:**
- Create directories with `mkdir(path, { recursive: true })` for `pipeline-config/` and four `pipeline-data/` subdirectories.
- Write `.gitkeep` files with `Bun.write(path, "")`.
- Write `registry.json` with `Bun.write(path, JSON.stringify({ pipelines: {} }, null, 2) + "\n")`.
- No try/catch (matching JS behavior).

**`start` command:**
- Resolve root from `--root` option or `PO_ROOT` env var. Exit 1 if neither set.
- Resolve to absolute path, set `process.env.PO_ROOT`.
- In source mode (`!isCompiledBinary()`), check for `src/ui/dist` using `Bun.file` or `fs.access`. Exit 1 if missing.
- Spawn UI child via `Bun.spawn` with `buildReexecArgs(["_start-ui"])`, env: `{ ...process.env, NODE_ENV: "production", PO_ROOT: absoluteRoot, PORT: port, PO_UI_PORT: undefined }`, `stdio: ["ignore", "pipe", "pipe"]`.
- Spawn orchestrator child similarly with `buildReexecArgs(["_start-orchestrator"])`, env: `{ ...process.env, NODE_ENV: "production", PO_ROOT: absoluteRoot }`.
- Read stdout/stderr from each child, prefix lines with `[ui]` or `[orc]`, write to parent's stdout/stderr.
- On child exit with non-zero code: kill the other child (SIGTERM, then SIGKILL after 5s timeout), exit with the failed child's exit code.
- On parent SIGINT/SIGTERM: run cleanup (SIGTERM to both children, SIGKILL escalation after 5s), then exit.
- Wrap in try/catch: on error, run cleanup, `process.exit(1)`.

**`submit` command:**
- Read and parse seed file with `Bun.file(seedFile).text()` then `JSON.parse`.
- Call `submitJobWithValidation({ dataDir: process.cwd(), seedObject })`.
- On success (`result.success`), log `Job submitted: ${result.jobId} (${result.jobName})`.
- On API failure, log failure message, `process.exit(1)`.
- Catch JSON parse / file errors, log, `process.exit(1)`.

**`status` command:**
- Create `PipelineOrchestrator` with `{ autoStart: false }`.
- If `jobName` provided: call `getStatus(jobName)`, `console.log(JSON.stringify(result, null, 2))`.
- If no `jobName`: call `listJobs()`, `console.table(result)`.
- No try/catch (matching JS behavior).

**`add-pipeline` command:**
- Validate slug against `KEBAB_CASE_REGEX`. Exit 1 on failure.
- Create `<root>/pipeline-config/<slug>/tasks/` with `mkdir(path, { recursive: true })`.
- Write `pipeline.json`: `{ name: slug, version: "1.0.0", description: "New pipeline", tasks: [] }`.
- Write `tasks/index.ts`: `export default {};`.
- Read existing `registry.json` (catch → empty registry).
- Add/replace entry: `registry.pipelines[slug] = { name: slug, description: "New pipeline", pipelinePath, taskRegistryPath }`.
- Write back `registry.json`.
- Wrap in try/catch: on error, log, `process.exit(1)`. Registry read failure is handled gracefully (fallback to empty registry).

**`add-pipeline-task` command:**
- Validate both slugs. Exit 1 on failure.
- Check pipeline `tasks/` directory exists via `fs.access`. Exit 1 if not.
- Generate task file content:
  - For each stage in `STAGE_NAMES`, generate an exported async function.
  - `ingestion` stage receives `({ data: { seed } })` parameter.
  - All other stages receive `({ data })` parameter.
  - Each function returns `{ output: {}, flags: {} }`.
  - Include a comment with the stage's purpose description from `getStagePurpose`.
- Write task file to `<root>/pipeline-config/<slug>/tasks/<task-slug>.ts`.
- Parse existing `tasks/index.ts` using regex (not `eval()`):
  - Match the default export object pattern.
  - Extract existing key-value pairs.
  - Add new entry: `"<task-slug>": "./<task-slug>.ts"`.
  - Sort keys alphabetically.
  - Write back as `export default { <sorted entries> };`.
- Call `updatePipelineJson(root, pipelineSlug, taskSlug)`.
- Wrap in try/catch: on error, log, `process.exit(1)`.

**Hidden subcommands:**
- `_start-ui`: Dynamic import `startServer` from `../ui/server.ts`. Call with `{ dataDir: process.env.PO_ROOT || process.cwd(), port: parseInt(process.env.PORT || "4000", 10) }`.
- `_start-orchestrator`: Validate `PO_ROOT` is set, exit 1 if not. Dynamic import `startOrchestrator` from `../core/orchestrator.ts`. Call with `{ dataDir: process.env.PO_ROOT }`. Register SIGINT/SIGTERM handlers calling `stop()` then `process.exit(0)`.
- `_run-job <jobId>`: Dynamic import `runPipelineJob` from `../core/pipeline-runner.ts`. Call with the job ID argument.

**Test:** `src/cli/__tests__/index.test.ts`

**`init` tests:**
- Call `handleInit` with a temp directory. Verify all expected directories exist. Verify `registry.json` contains `{ "pipelines": {} }`. Verify `.gitkeep` files exist.

**`start` tests:**
- Mock `Bun.spawn`. Call `handleStart` with valid root. Verify two children spawned with correct env vars.
- Call `handleStart` with no root and no `PO_ROOT`. Verify `process.exit(1)` is called.

**`add-pipeline` tests:**
- Call `handleAddPipeline` with a valid slug. Verify directory tree, `pipeline.json`, `tasks/index.ts`, and `registry.json` are created correctly.
- Call with an invalid slug (`"INVALID"`). Verify `process.exit(1)`.

**`add-pipeline-task` tests:**
- Set up a pipeline directory. Call `handleAddPipelineTask`. Verify task file has all 11 stage stubs. Verify `tasks/index.ts` includes the new task. Verify `pipeline.json` includes the task slug.
- Verify `ingestion` stage has `{ seed }` destructuring and other stages have `data` parameter.
- Verify task index keys are sorted alphabetically.

**`submit` tests:**
- Mock `submitJobWithValidation` to return `{ success: true, jobId: "123", jobName: "test" }`. Write a temp seed file. Call `handleSubmit`. Verify success log.
- Mock `submitJobWithValidation` to return `{ success: false, message: "error" }`. Verify `process.exit(1)`.

**`analyze` tests:**
- Delegate to `analyzeTaskFile` test coverage (Step 5).

**Self-reexec integration tests:**
- Verify `buildReexecArgs(["_start-ui"])` produces valid spawn args in source mode.
