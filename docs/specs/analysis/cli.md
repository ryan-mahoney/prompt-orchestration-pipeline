# Specification: `cli`

**Source files analyzed:**
- `src/cli/index.js`
- `src/cli/run-orchestrator.js`
- `src/cli/analyze-task.js`
- `src/cli/update-pipeline-json.js`
- `src/cli/self-reexec.js`

---

## 1. Purpose & Responsibilities

The `cli` module is the primary command-line entry point to the pipeline orchestration system. It provides a multi-command interface through which operators initialize workspace directory structures, start the orchestrator and UI server, submit jobs, query job status, scaffold new pipelines and tasks, and perform static task analysis.

**Responsibilities:**

- Parsing and dispatching CLI commands and global options to appropriate handlers.
- Initializing the on-disk directory structure and registry for a new pipeline workspace.
- Starting the orchestrator and UI server as co-managed child processes via self-reexec, with coordinated lifecycle management (signal forwarding, kill-others-on-fail).
- Submitting job seed files for processing by delegating to the API layer.
- Querying job status (individual or listing all) by delegating to the orchestrator API.
- Scaffolding new pipeline configurations: creating directory trees, `pipeline.json`, `tasks/index.js`, and updating the central `registry.json`.
- Scaffolding new task files within a pipeline: generating stage-stub source files and updating the task index and `pipeline.json`.
- Running static analysis on a task file and outputting results as JSON.
- Providing hidden subcommands (`_start-ui`, `_start-orchestrator`, `_run-job`) that serve as spawn targets for the self-reexec process model, enabling the same executable (source or compiled binary) to run isolated subsystems.

**Boundaries:**

- The CLI does not implement any pipeline execution logic itself; it delegates to `core/orchestrator`, `core/pipeline-runner`, `ui/server`, and `task-analysis` modules.
- It does not validate seed file contents beyond JSON parsing; validation is delegated to `submitJobWithValidation`.
- It does not build UI assets; it only checks for their existence and errors out if missing (in source mode).

**Pattern:** The CLI acts as a **command dispatcher and process coordinator**. The `start` command in particular implements a **supervisor pattern**, spawning and monitoring two child processes and implementing coordinated shutdown.

---

## 2. Public Interface

The CLI module's public interface is the set of commands exposed via the `commander` library. It also exports functions from helper files used internally.

### CLI Commands (User-Facing)

#### `pipeline-orchestrator init`

- **Purpose:** Creates the initial directory tree and registry file for a pipeline workspace.
- **Parameters:**
  - `--root <path>` (optional, global): The root directory for pipelines. Defaults to `./pipelines` relative to the current working directory.
- **Behavior:** Creates `pipeline-config/`, `pipeline-data/pending/`, `pipeline-data/current/`, `pipeline-data/complete/`, `pipeline-data/rejected/` directories (all with `recursive: true`). Writes empty `.gitkeep` files in each pipeline-data subdirectory. Writes `registry.json` with content `{ "pipelines": {} }` (pretty-printed with trailing newline).
- **Return/Output:** Logs confirmation message to stdout.
- **Failure modes:** File system permission errors will propagate unhandled (no try/catch wrapping the init handler).

#### `pipeline-orchestrator start`

- **Purpose:** Starts the orchestrator and UI server as co-managed child processes.
- **Parameters:**
  - `--root <path>` (optional, global): Pipeline root directory. Falls back to `PO_ROOT` environment variable. **Required** — exits with code 1 if neither is provided.
  - `--port <port>` (optional, global): UI server port. Defaults to `"4000"`.
- **Behavior:**
  1. Resolves the root path to an absolute path and sets `PO_ROOT` in the process environment.
  2. In source mode (non-compiled binary), checks for prebuilt UI assets at `<PKG_ROOT>/src/ui/dist`. Exits with code 1 and an error message if missing.
  3. Spawns the UI server via `buildReexecArgs(["_start-ui"])` with environment variables `NODE_ENV=production`, `PO_ROOT=<absoluteRoot>`, `PORT=<port>`, and `PO_UI_PORT=undefined`.
  4. Spawns the orchestrator via `buildReexecArgs(["_start-orchestrator"])` with environment variables `NODE_ENV=production`, `PO_ROOT=<absoluteRoot>`.
  5. Pipes stdout/stderr from both children to the parent with `[ui]` and `[orc]` prefixes.
  6. Implements kill-others-on-fail: if either child exits with a non-zero code, the other is terminated via the cleanup function.
  7. Handles `SIGINT` and `SIGTERM` on the parent process by running cleanup and exiting.
- **Cleanup behavior:** Sends `SIGTERM` to each living child, then escalates to `SIGKILL` after a 5-second timeout if the child has not exited.
- **Return/Output:** Long-running process; logs startup messages and prefixed child output to stdout/stderr.
- **Failure modes:** Spawn errors on either child process trigger cleanup and `process.exit(1)`. General errors in the try block also trigger cleanup and exit.

#### `pipeline-orchestrator submit <seed-file>`

- **Purpose:** Submits a new job by reading a JSON seed file and passing it to the API.
- **Parameters:**
  - `seed-file` (required, positional): Path to a JSON file containing the job seed object.
- **Behavior:** Reads and parses the seed file as JSON, then calls `submitJobWithValidation` with `{ dataDir: process.cwd(), seedObject: <parsed seed> }`.
- **Return/Output:** On success, logs `Job submitted: <jobId> (<jobName>)`. On API failure (success=false), logs failure message and exits with code 1.
- **Failure modes:** JSON parse errors or file-not-found errors are caught and logged with `process.exit(1)`.

#### `pipeline-orchestrator status [job-name]`

- **Purpose:** Queries job status — either a specific job or all jobs.
- **Parameters:**
  - `job-name` (optional, positional): The name of a specific job to query.
- **Behavior:** Creates a `PipelineOrchestrator` instance with `{ autoStart: false }`. If `job-name` is provided, calls `getStatus(jobName)` and outputs the result as pretty-printed JSON. Otherwise, calls `listJobs()` and outputs a table via `console.table`.
- **Return/Output:** JSON or table to stdout.
- **Failure modes:** No explicit error handling — errors from the orchestrator will propagate as unhandled rejections.

#### `pipeline-orchestrator add-pipeline <pipeline-slug>`

- **Purpose:** Scaffolds a new pipeline within the workspace.
- **Parameters:**
  - `pipeline-slug` (required, positional): Must match kebab-case pattern `/^[a-z0-9-]+$/`. Exits with code 1 if validation fails.
  - `--root <path>` (optional, global): Defaults to `./pipelines`.
- **Behavior:**
  1. Creates `<root>/pipeline-config/<slug>/tasks/` directory tree (recursive).
  2. Writes `pipeline.json` with `{ name, version: "1.0.0", description: "New pipeline", tasks: [] }`.
  3. Writes `tasks/index.js` with `export default {};`.
  4. Reads existing `registry.json` (or creates empty registry on failure), adds/replaces the pipeline entry with `{ name, description, pipelinePath, taskRegistryPath }`, and writes it back.
- **Return/Output:** Logs success message.
- **Failure modes:** File system errors caught and logged with `process.exit(1)`. Registry read failure (missing or invalid) handled gracefully by falling back to empty registry.

#### `pipeline-orchestrator add-pipeline-task <pipeline-slug> <task-slug>`

- **Purpose:** Scaffolds a new task file within an existing pipeline.
- **Parameters:**
  - `pipeline-slug` (required, positional): Must be kebab-case.
  - `task-slug` (required, positional): Must be kebab-case.
  - `--root <path>` (optional, global): Defaults to `./pipelines`.
- **Behavior:**
  1. Validates both slugs against the kebab-case regex.
  2. Verifies the pipeline's `tasks/` directory exists (via `fs.access`); exits with error if not.
  3. Generates a task file with exported function stubs for all 11 canonical stage names. The `ingestion` stage receives a destructured `data: { seed }` parameter; all other stages receive `data` directly. Each stage function returns `{ output: {}, flags }`.
  4. Updates `tasks/index.js` by regex-parsing the existing default export object, adding the new task mapping (`<slug>: "./<slug>.js"`), sorting keys alphabetically, and writing back.
  5. Delegates to `updatePipelineJson` to append the task slug to `pipeline.json`'s `tasks` array.
- **Return/Output:** Logs success message.
- **Failure modes:** File system errors, invalid pipeline directory, or index parsing issues caught and logged with `process.exit(1)`.

#### `pipeline-orchestrator analyze <task-path>`

- **Purpose:** Runs static analysis on a task file and outputs metadata as JSON.
- **Parameters:**
  - `task-path` (required, positional): Path to the task source file (relative or absolute).
- **Behavior:** Delegates to `analyzeTaskFile` which reads the file, runs `analyzeTask` from the `task-analysis` module, and outputs the result as pretty-printed JSON.
- **Return/Output:** JSON analysis result to stdout.
- **Failure modes:** File-not-found exits with code 1. In development/debug mode (`NODE_ENV=development` or `DEBUG_TASK_ANALYSIS=1`), full stack traces are printed. In normal mode, only the error message is shown.

### Hidden Subcommands (Internal)

#### `_start-ui`

- **Purpose:** Starts only the UI server. Used as a spawn target by the `start` command.
- **Behavior:** Dynamically imports `startServer` from `../ui/server.js` and calls it with `{ dataDir: PO_ROOT || cwd, port: parseInt(PORT) || 4000 }`. The port is parsed as an integer from the `PORT` environment variable.

#### `_start-orchestrator`

- **Purpose:** Starts only the core orchestrator. Used as a spawn target by the `start` command.
- **Behavior:** Validates that `PO_ROOT` environment variable is set; exits with code 1 if missing. Dynamically imports `startOrchestrator` from `../core/orchestrator.js` and calls it with `{ dataDir: PO_ROOT }`. Registers SIGINT/SIGTERM handlers that call `stop()` before exiting.

#### `_run-job <jobId>`

- **Purpose:** Runs a single pipeline job by ID. Used for isolated job execution.
- **Behavior:** Dynamically imports `runPipelineJob` from `../core/pipeline-runner.js` and runs it with the provided job ID.

### Exported Functions (from helper files)

#### `analyzeTaskFile(taskPath)` — from `analyze-task.js`

- **Purpose:** Reads a task file, runs the `analyzeTask` static analyzer on it, and outputs the result as JSON to stdout.
- **Parameters:**
  - `taskPath` (string, required): Path to the task file. Resolved to absolute if relative.
- **Return value:** `Promise<void>` — output is written to stdout.
- **Failure modes:** ENOENT logged and exits with code 1. Other errors logged (with stack in dev mode) and exit with code 1.

#### `updatePipelineJson(root, pipelineSlug, taskSlug)` — from `update-pipeline-json.js`

- **Purpose:** Appends a task slug to the `tasks` array in a pipeline's `pipeline.json`.
- **Parameters:**
  - `root` (string, required): Pipeline root directory.
  - `pipelineSlug` (string, required): The pipeline identifier.
  - `taskSlug` (string, required): The task identifier to add.
- **Return value:** `Promise<void>`.
- **Behavior:** Reads `pipeline.json`, parses it, ensures `tasks` is an array, appends `taskSlug` if not already present, and writes back. If the file is missing or invalid, creates a minimal config with `{ name, version: "1.0.0", description: "New pipeline", tasks: [] }`.
- **Failure modes:** File system write errors propagate to the caller.

#### `buildReexecArgs(command)` — from `self-reexec.js`

- **Purpose:** Constructs spawn arguments for re-executing the CLI with a hidden subcommand, adapting for both source and compiled binary modes.
- **Parameters:**
  - `command` (string array, required): The hidden command and its arguments, e.g., `["_run-job", jobId]`.
- **Return value:** `{ execPath: string, args: string[] }` — the executable path and argument array to pass to `spawn`.
- **Behavior:** In compiled binary mode (detected by `/$bunfs/` in the file path), returns `{ execPath: process.execPath, args: [...command] }`. In source mode, returns `{ execPath: process.execPath, args: [CLI_ENTRY, ...command] }` where `CLI_ENTRY` is the resolved path to `src/cli/index.js`.

#### `isCompiledBinary()` — from `self-reexec.js`

- **Purpose:** Detects whether the current process is running from a compiled Bun standalone binary.
- **Parameters:** None.
- **Return value:** `boolean` — `true` if the current file path contains `/$bunfs/` (Bun's virtual filesystem for compiled binaries).
- **Behavior:** Normalizes Windows backslashes (`\\`) to forward slashes (`/`) before checking for `/$bunfs/`, ensuring correct detection on Windows platforms.

---

## 3. Data Models & Structures

### Registry Object

- **Purpose:** Central index of all pipelines in the workspace.
- **Fields:**
  - `pipelines` (object, required): Map of pipeline slug to pipeline descriptor.
    - Each entry contains:
      - `name` (string): The pipeline slug.
      - `description` (string): Human-readable description. Defaults to `"New pipeline"` for scaffolded entries.
      - `pipelinePath` (string): Relative path to the pipeline's `pipeline.json` from the workspace root.
      - `taskRegistryPath` (string): Relative path to the pipeline's `tasks/index.js` from the workspace root.
- **Lifecycle:** Created by `init`, updated by `add-pipeline`.
- **Ownership:** Owned by the workspace; read/written by both the CLI and the core orchestrator.
- **Serialization:** JSON file at `<root>/pipeline-config/registry.json`, pretty-printed with 2-space indent and trailing newline.

### Pipeline Config Object

- **Purpose:** Defines a single pipeline's metadata and task list.
- **Fields:**
  - `name` (string): The pipeline slug.
  - `version` (string): Semantic version string. Defaults to `"1.0.0"`.
  - `description` (string): Human-readable description. Defaults to `"New pipeline"`.
  - `tasks` (array of strings): Ordered list of task slugs belonging to this pipeline.
- **Lifecycle:** Created by `add-pipeline`, modified by `add-pipeline-task`.
- **Serialization:** JSON file at `<root>/pipeline-config/<slug>/pipeline.json`, pretty-printed with 2-space indent and trailing newline.

### Task Index Object

- **Purpose:** Maps task slugs to their module file paths for dynamic loading.
- **Fields:** Flat key-value map where keys are task slugs (strings) and values are relative paths (strings, e.g., `"./task-slug.js"`).
- **Lifecycle:** Created by `add-pipeline` (empty), updated by `add-pipeline-task`.
- **Serialization:** Written as a JavaScript module (`export default { ... };`) at `<root>/pipeline-config/<slug>/tasks/index.js`. Keys are sorted alphabetically for stable output.

### Stage Names Constant

- **Purpose:** Canonical ordered list of pipeline stage names shared between the CLI scaffolding and the core task runner.
- **Value:** `["ingestion", "preProcessing", "promptTemplating", "inference", "parsing", "validateStructure", "validateQuality", "critique", "refine", "finalValidation", "integration"]` — 11 stages.
- **Ownership:** Defined in `src/cli/index.js` as `STAGE_NAMES`. The comment indicates these must match `src/core/task-runner.js`.

### Stage Purpose Descriptions

- **Purpose:** Human-readable descriptions of each stage's purpose, used when scaffolding task file comments.
- **Ownership:** Defined as a local lookup map within the `getStagePurpose` helper function in `index.js`.
- **Values:**

| Stage Name | Purpose Description |
|---|---|
| `ingestion` | load/shape input for downstream stages (no external side-effects required) |
| `preProcessing` | prepare and clean data for main processing |
| `promptTemplating` | generate or format prompts for LLM interaction |
| `inference` | execute LLM calls or other model inference |
| `parsing` | extract and structure results from model outputs |
| `validateStructure` | ensure output meets expected format and schema |
| `validateQuality` | check content quality and completeness |
| `critique` | analyze and evaluate results against criteria |
| `refine` | improve and optimize outputs based on feedback |
| `finalValidation` | perform final checks before completion |
| `integration` | integrate results into downstream systems or workflows |

### Reexec Arguments Object

- **Purpose:** Return value from `buildReexecArgs` used by `spawn`.
- **Fields:**
  - `execPath` (string): The path to the executable (always `process.execPath`).
  - `args` (string array): Command-line arguments. In source mode, includes the CLI entry script as the first argument; in compiled mode, starts directly with the command.

---

## 4. Behavioral Contracts

### Preconditions

- `init`: No preconditions — creates structure from scratch. Safe to re-run (uses `recursive: true` for directory creation).
- `start`: Either `--root` or `PO_ROOT` environment variable must be set. In source mode, `src/ui/dist` must exist.
- `submit`: The seed file must exist and contain valid JSON.
- `status`: The orchestrator must be able to connect to the pipeline data directory (implicit via `PipelineOrchestrator.create`).
- `add-pipeline`: The root directory should already exist (created by `init`).
- `add-pipeline-task`: The pipeline must already exist (the `tasks/` directory must be accessible).

### Postconditions

- `init`: Directory tree exists with exactly the specified structure; `registry.json` contains `{ "pipelines": {} }`.
- `start`: Two child processes are running and being monitored; parent process is blocking.
- `add-pipeline`: `pipeline.json`, `tasks/index.js`, and the registry entry all exist and are consistent.
- `add-pipeline-task`: Task file exists with all 11 stage stubs; `tasks/index.js` includes the new task mapping (sorted); `pipeline.json` includes the task slug in its `tasks` array.
- `updatePipelineJson`: The task slug appears in the `tasks` array exactly once, at the end (if newly added).

### Invariants

- All slug inputs must match `/^[a-z0-9-]+$/` (kebab-case).
- The `STAGE_NAMES` array must contain exactly the 11 canonical stage names in the specified order.
- `registry.json` always has a `pipelines` key (created or defaulted).
- `pipeline.json` always has a `tasks` array (created or defaulted).
- Index files sort keys alphabetically for deterministic output.
- The `ingestion` stage always destructures `data: { seed }` while other stages receive `data` directly.

### Ordering Guarantees

- `add-pipeline-task` operations within a single invocation are sequential: task file is written before the index is updated, and the index is updated before `pipeline.json`.
- The `start` command spawns the UI server before the orchestrator, though both run concurrently.

### Concurrency Behavior

- The CLI is not designed for concurrent invocations against the same workspace. Multiple simultaneous `add-pipeline` or `add-pipeline-task` calls could produce race conditions on `registry.json`, `tasks/index.js`, or `pipeline.json` due to non-atomic read-modify-write patterns.
- The `start` command manages two concurrent child processes internally but serializes their spawn order.

---

## 5. State Management

### In-Memory State

- **`program`** (Commander instance): Singleton command definition; created at module load, parsed once at the end via `program.parse()`.
- **`STAGE_NAMES`** (frozen constant array): Used during task scaffolding; never mutated.
- **`PKG_ROOT`** (derived constant): Package root path computed from `import.meta.url`; never mutated.
- **`uiChild`, `orchestratorChild`** (ChildProcess references): Held in the `start` command's closure for lifecycle management. Not accessible outside that closure.
- **`childrenExited`, `exitCode`** (counters): Track child process exits within the `start` command closure.

### Persisted State

The CLI reads and writes the following filesystem structures:

| Path Pattern | Operation | Format |
|---|---|---|
| `<root>/pipeline-config/registry.json` | Read/Write | JSON with trailing newline |
| `<root>/pipeline-config/<slug>/pipeline.json` | Read/Write | JSON with trailing newline |
| `<root>/pipeline-config/<slug>/tasks/index.js` | Read/Write | ESM module with default export |
| `<root>/pipeline-config/<slug>/tasks/<task>.js` | Write only | ESM module with stage function stubs |
| `<root>/pipeline-data/{pending,current,complete,rejected}/` | Create dirs | Directories with `.gitkeep` files |

### Crash Recovery

- If the process crashes during `init`, partial directory structures may exist. Re-running `init` is safe due to `recursive: true` and file overwrites.
- If the process crashes during `add-pipeline` or `add-pipeline-task`, the registry, pipeline config, and task index may be inconsistent (e.g., task file written but index not updated). There is no transactional or rollback mechanism.
- If the `start` command's parent process crashes, child processes may become orphans. The cleanup function sends SIGTERM but the 5-second SIGKILL escalation timeout may not fire if the parent itself dies.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What is used | Nature | Coupling |
|---|---|---|---|
| `src/api/index.js` | `submitJobWithValidation`, `PipelineOrchestrator` | Runtime import | Moderate — the CLI calls API functions directly for `submit` and `status` commands |
| `src/ui/server.js` | `startServer` | Dynamic import (in `_start-ui`) | Loose — only imported in the hidden subcommand |
| `src/core/orchestrator.js` | `startOrchestrator` | Dynamic import (in `_start-orchestrator`) | Loose — only imported in the hidden subcommand |
| `src/core/pipeline-runner.js` | `runPipelineJob` | Dynamic import (in `_run-job`) | Loose — only imported in the hidden subcommand |
| `src/task-analysis/index.js` | `analyzeTask` | Dynamic import (in `analyze-task.js`) | Loose — imported at call time |
| `src/cli/update-pipeline-json.js` | `updatePipelineJson` | Static import | Tight — called directly from `add-pipeline-task` |
| `src/cli/analyze-task.js` | `analyzeTaskFile` | Static import | Tight — called directly from `analyze` command |
| `src/cli/self-reexec.js` | `buildReexecArgs`, `isCompiledBinary` | Static import | Tight — integral to the `start` command |

### 6.2 External Dependencies

| Package | What it provides | How it's used | Replaceability |
|---|---|---|---|
| `commander` | CLI argument parsing and command routing | The `Command` class defines all commands, options, and dispatch logic | Replaceable with any CLI framework; usage is localized to `index.js` |

### 6.3 System-Level Dependencies

- **File system:** Extensive read/write operations to the pipeline root directory. Requires write permissions for `init`, `add-pipeline`, and `add-pipeline-task`.
- **Environment variables:**
  - `PO_ROOT`: Required for `start` if `--root` is not provided. Set by the CLI for child processes.
  - `PORT`: Set for the UI server child process.
  - `NODE_ENV`: Set to `"production"` for spawned children. Used in `analyze-task.js` to control error verbosity (development mode shows stack traces).
  - `DEBUG_TASK_ANALYSIS`: When set to `"1"`, enables verbose error output in the analyze command.
  - `PO_UI_PORT`: Explicitly set to `undefined` in the UI child environment to ensure `PORT` takes precedence.
- **Process management:** Uses `child_process.spawn` to create child processes. Relies on POSIX signals (`SIGINT`, `SIGTERM`, `SIGKILL`) for lifecycle management.
- **Bun runtime:** The shebang line (`#!/usr/bin/env bun`) indicates this is designed to run under the Bun runtime. The `isCompiledBinary` function specifically checks for Bun's virtual filesystem path (`/$bunfs/`).
- **`import.meta.url`:** Used for deriving the package root and CLI entry paths. Requires ESM module support.

---

## 7. Side Effects & I/O

### File System

| Operation | Location | When | Async |
|---|---|---|---|
| Directory creation | `<root>/pipeline-config/`, `<root>/pipeline-data/*` | `init` | Yes |
| Write `.gitkeep` files | `<root>/pipeline-data/*/` | `init` | Yes |
| Write `registry.json` | `<root>/pipeline-config/` | `init`, `add-pipeline` | Yes |
| Read `registry.json` | `<root>/pipeline-config/` | `add-pipeline` | Yes |
| Directory creation | `<root>/pipeline-config/<slug>/tasks/` | `add-pipeline` | Yes |
| Write `pipeline.json` | `<root>/pipeline-config/<slug>/` | `add-pipeline`, `add-pipeline-task` (via `updatePipelineJson`) | Yes |
| Write `tasks/index.js` | `<root>/pipeline-config/<slug>/tasks/` | `add-pipeline`, `add-pipeline-task` | Yes |
| Write `<task>.js` | `<root>/pipeline-config/<slug>/tasks/` | `add-pipeline-task` | Yes |
| Read `tasks/index.js` | `<root>/pipeline-config/<slug>/tasks/` | `add-pipeline-task` | Yes |
| Read `pipeline.json` | `<root>/pipeline-config/<slug>/` | `add-pipeline-task` (via `updatePipelineJson`) | Yes |
| Read seed file | Caller-specified path | `submit` | Yes |
| Read task file | Caller-specified path | `analyze` | Yes |
| Check `dist/` directory | `<PKG_ROOT>/src/ui/dist` | `start` (source mode) | Yes |

### Process Management

- **Spawn:** The `start` command spawns two child processes using `child_process.spawn` with `stdio: "pipe"`.
- **Signal handling:** SIGINT and SIGTERM handlers on the parent process trigger cleanup (SIGTERM to children, SIGKILL after 5s timeout).
- **Exit codes:** Various commands call `process.exit(1)` on failure, `process.exit(0)` on clean shutdown.

### Logging & Observability

- Standard `console.log` for informational output.
- Standard `console.error` for error output.
- `console.table` for job listing display.
- Child process output prefixed with `[ui]` and `[orc]` for the `start` command.
- In the `analyze` command, error verbosity is controlled by environment (development mode shows full stack traces).

### Timing & Scheduling

- The cleanup function uses `setTimeout` with a 5-second delay for SIGKILL escalation. These timers are fire-and-forget and may not execute if the parent process exits first.

---

## 8. Error Handling & Failure Modes

### Error Categories & Propagation

| Command | Error Type | Handling Strategy |
|---|---|---|
| `init` | File system errors (permissions, disk full) | **Unhandled** — the `init` handler has no try/catch; errors propagate as unhandled promise rejections |
| `start` | Missing `PO_ROOT` | Log error, `process.exit(1)` |
| `start` | Missing UI assets (source mode) | Log error, `process.exit(1)` |
| `start` | Child spawn error | Log error, cleanup, `process.exit(1)` |
| `start` | Child non-zero exit | Log, cleanup other child, exit with failed child's exit code |
| `submit` | File not found / JSON parse error | Catch, log, `process.exit(1)` |
| `submit` | API returns `success: false` | Log failure message, `process.exit(1)` |
| `status` | Orchestrator errors | **Unhandled** — no try/catch wrapper |
| `add-pipeline` | Invalid slug | Log error, `process.exit(1)` |
| `add-pipeline` | File system errors | Catch, log, `process.exit(1)` |
| `add-pipeline` | Registry read failure | Graceful fallback to empty registry (not an error) |
| `add-pipeline-task` | Invalid slug(s) | Log error, `process.exit(1)` |
| `add-pipeline-task` | Pipeline not found | Log error, `process.exit(1)` |
| `add-pipeline-task` | Index parse failure | Graceful fallback to empty index |
| `add-pipeline-task` | File system errors | Catch, log, `process.exit(1)` |
| `analyze` | File not found (ENOENT) | Log error, `process.exit(1)` |
| `analyze` | Analysis error (dev mode) | Log full stack trace, `process.exit(1)` |
| `analyze` | Analysis error (prod mode) | Log error message only, `process.exit(1)` |
| `updatePipelineJson` | File read failure | Graceful fallback to minimal config |
| `updatePipelineJson` | File write failure | Propagates to caller |

### Partial Failure

- `add-pipeline`: If the registry write fails after pipeline.json and tasks/index.js are written, the pipeline directory will exist but the registry will not reference it.
- `add-pipeline-task`: If the index or pipeline.json update fails after the task file is written, the task file will exist but not be registered.
- There is no rollback or cleanup mechanism for partial failures in any scaffolding command.

---

## 9. Integration Points & Data Flow

### Upstream

- **Terminal user / shell scripts:** Invokes the CLI binary or script directly with commands and arguments.
- **`start` command self-reexec:** The parent process spawns itself (or its compiled binary) with hidden subcommands as child processes.

### Downstream

| CLI Command | Downstream Module(s) | What is passed |
|---|---|---|
| `start` → `_start-ui` | `ui/server` (`startServer`) | `{ dataDir, port }` |
| `start` → `_start-orchestrator` | `core/orchestrator` (`startOrchestrator`) | `{ dataDir }` |
| `_run-job` | `core/pipeline-runner` (`runPipelineJob`) | `jobId` (string) |
| `submit` | `api/index` (`submitJobWithValidation`) | `{ dataDir, seedObject }` |
| `status` | `api/index` (`PipelineOrchestrator.create`) | `{ autoStart: false }` |
| `analyze` | `task-analysis/index` (`analyzeTask`) | `(code, absolutePath)` |
| `add-pipeline-task` | `cli/update-pipeline-json` (`updatePipelineJson`) | `(root, pipelineSlug, taskSlug)` |

### Data Transformation

- `submit`: Reads raw file → parses JSON → wraps in `{ dataDir, seedObject }` → passes to API.
- `analyze`: Reads raw file as string → passes to `analyzeTask` → formats result as pretty JSON for stdout.
- `add-pipeline-task`: Generates stage-stub source code from the `STAGE_NAMES` constant and `getStagePurpose` lookup.
- `add-pipeline` / `add-pipeline-task`: Registry and index files undergo read-modify-write cycles (parse JSON/JS → add entry → serialize back).

### Control Flow — `start` Command (Primary Use Case)

1. Validate root exists → resolve to absolute path → set `PO_ROOT` env.
2. Check for UI dist assets (source mode only).
3. Spawn UI server child process via self-reexec.
4. Spawn orchestrator child process via self-reexec.
5. Attach stdout/stderr pipe handlers with prefixes.
6. Attach exit handlers (kill-others-on-fail logic).
7. Attach error handlers.
8. Register SIGINT/SIGTERM handlers on parent.
9. Block indefinitely until children exit or parent receives signal.

### System-Wide Patterns

The CLI participates in the **self-reexec pattern**: the `start` command spawns the same executable with hidden subcommands (`_start-ui`, `_start-orchestrator`, `_run-job`) to run subsystems in isolated child processes. This enables the compiled binary to act as both the supervisor and the worker.

---

## 10. Edge Cases & Implicit Behavior

- **Default root:** Multiple commands default to `path.resolve(process.cwd(), "pipelines")` when `--root` is not provided. The `start` command is the exception — it requires `--root` or `PO_ROOT` and will not fall back to a default.
- **`PO_UI_PORT` suppression:** The `start` command explicitly sets `PO_UI_PORT: undefined` in the UI child's environment to ensure `PORT` takes precedence. This suggests the UI server has a separate `PO_UI_PORT` configuration path that could override `PORT`.
- **Registry resilience:** Both `add-pipeline` and `updatePipelineJson` handle missing or malformed files gracefully by falling back to empty/minimal defaults. This means a corrupted registry or pipeline config will be silently overwritten.
- **Index parsing via `eval`:** The `add-pipeline-task` command uses `eval()` to parse the existing `tasks/index.js` default export. This is noted in a comment as "safe in this controlled context" but presents a code injection risk if the index file is tampered with.
- **Idempotent init:** Running `init` multiple times overwrites `registry.json` to `{ "pipelines": {} }`, which would **destroy existing pipeline registrations**. The directory creation itself is idempotent, but the registry write is destructive.
- **Task deduplication:** `updatePipelineJson` checks `pipelineConfig.tasks.includes(taskSlug)` before appending, preventing duplicate entries. But the task file and index entry are always written unconditionally, overwriting any existing task with the same slug.
- **SIGKILL escalation timers:** The 5-second `setTimeout` for SIGKILL escalation after SIGTERM uses an unref'd-style fire-and-forget pattern. If the parent exits before the timer fires (e.g., due to another handler calling `process.exit()`), the SIGKILL never occurs.
- **`run-orchestrator.js` backward compatibility:** This file is described in a comment as a "thin wrapper" kept for backward compatibility with external scripts that may reference it directly. It duplicates the logic of the `_start-orchestrator` hidden command.
- **`process.exit()` in Commander actions:** Multiple action handlers call `process.exit()` directly, which may prevent proper Commander cleanup. The mocked `process.exit` in tests avoids this issue but means the actual process behavior differs from test behavior.

---

## 11. Open Questions & Ambiguities

1. **Stage names synchronization:** The `STAGE_NAMES` array in `index.js` has a comment saying it "must match `src/core/task-runner.js`". There is no mechanism enforcing this — it is a manual contract. If the task runner's stages change, the CLI scaffolding will produce incorrect task files.

2. **`status` command implementation discrepancy:** The `status` command uses `PipelineOrchestrator.create({ autoStart: false })` — a static factory method. But the tests mock `PipelineOrchestrator` as a constructor and call `orchestrator.initialize()`. It is unclear whether `create` and `new + initialize` are equivalent or if the tests are outdated.

3. **`eval()` in index parsing:** The use of `eval` to parse the task index file raises security concerns in environments where the index file could be modified by untrusted actors. There is no documentation on whether this is a known trade-off.

4. **Port type inconsistency:** The `--port` option defaults to the string `"4000"`. The `_start-ui` handler parses it with `parseInt`. But in the `start` command, the port is passed as a string to the environment variable `PORT`. The UI server presumably handles the string-to-number conversion internally.

5. **`init` overwriting registry:** Running `init` unconditionally writes `{ "pipelines": {} }` to `registry.json`. If a workspace already has registered pipelines, `init` will erase them. Whether this is intentional (full reset) or an oversight is unclear.

6. **Missing error handling in `init` and `status`:** The `init` and `status` command handlers have no try/catch blocks. Errors will surface as unhandled promise rejections. This may be intentional (letting Commander handle them) or an oversight.

7. **`_run-job` usage:** The `_run-job` hidden command exists and is importable but is not invoked anywhere in the `start` command or other visible code paths in this module. It may be used by the orchestrator when spawning isolated job runners, but this is not confirmed from the CLI source alone.

8. **Compiled binary asset embedding:** The `start` command skips the UI dist check when `isCompiledBinary()` returns true, with a comment noting "assets are embedded." The mechanism for embedding is not documented in this module.
