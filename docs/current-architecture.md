# Current Architecture

This document outlines the architecture of the Prompt Orchestration Pipeline (POP) as implemented in `src/core`.

## Overview

The system is a file-based, process-isolated orchestration engine designed to run pipelines of tasks. It uses a "watch folder" pattern to trigger jobs and manages state through atomic file operations, ensuring robustness and observability.

## Core Components

### 1. Orchestrator (`src/core/orchestrator.js`)
The **Orchestrator** is the main daemon responsible for job lifecycle management.

*   **Responsibility**: Monitors for new work and manages runner processes.
*   **Mechanism**: Uses `chokidar` to watch the `pipeline-data/pending` directory.
*   **Job Trigger**: When a `*-seed.json` file appears in `pending/`, the orchestrator:
    1.  Validates the seed (checks for `pipeline` slug).
    2.  Moves the seed to `pipeline-data/current/{jobId}/`.
    3.  Writes a normalized per-run `pipeline.json` copy into the job directory.
    4.  Initializes the job status file (`tasks-status.json`).
    5.  Spawns a **Pipeline Runner** process.
*   **Concurrency**: Maintains a registry of running child processes.

### 2. Pipeline Runner (`src/core/pipeline-runner.js`)
The **Pipeline Runner** is an ephemeral process spawned for a single job execution.

*   **Responsibility**: Executes a specific pipeline definition for a specific job.
*   **Process**:
    1.  **Initialization**: Loads `seed.json` and the run-scoped `pipeline.json` copy when present, falling back to shared pipeline config for legacy jobs.
    2.  **Validation**: Validates the pipeline structure.
    3.  **Task Loop**: Re-reads the per-run definition and `tasks-status.json` each iteration, then selects the first task that is neither `done` nor `skipped`.
        *   Checks upstream dependencies (previous tasks must be `done` or `skipped`).
        *   Evaluates lifecycle policies (e.g., stopping if paused).
        *   Prepares the task environment (creating directories, validating symlinks).
        *   Delegates execution to the **Task Runner**.
        *   Applies task-written run controls after successful task execution.
    4.  **Completion**: Upon success, moves the job directory from `current/` to `complete/` and logs the run to `runs.jsonl`.
*   **Isolation**: Runs in its own process, ensuring that a crash in one pipeline does not affect the orchestrator or other jobs.

#### Run Control Primitives
After a task succeeds, the runner looks for `tasks/{taskName}/control.json`. The file can request:

*   `patch.add`: append new task entries to the current run's `pipeline.json`.
*   `skip`: mark later pending tasks as `skipped`, with a reason and owner.
*   `pause`: put the job in `waiting` with a gate that must be approved or rejected in the UI.

Control validation is pure and fail-fast: invalid control files mark the emitting task failed with `ControlValidationError` and do not retry the task. Successful control application is crash-safe: the per-run pipeline patch is written atomically, then one status write records task completion, `controlApplied`, skips, inserted pending tasks, and any gate.

### 3. Task Runner (`src/core/task-runner.js`)
The **Task Runner** executes the actual logic of a single task.

*   **Responsibility**: Runs a task module through a fixed sequence of stages.
*   **Stages**: The architecture enforces a standard lifecycle for all tasks:
    1.  `ingestion`
    2.  `preProcessing`
    3.  `promptTemplating`
    4.  `inference` (LLM interaction)
    5.  `parsing`
    6.  `validateStructure`
    7.  `validateQuality`
    8.  `critique` (conditional loop)
    9.  `refine` (conditional loop)
    10. `finalValidation`
    11. `integration`
*   **Dynamic Loading**: Loads task implementations dynamically using `loadFreshModule`.
*   **Observability**:
    *   Captures `console` output to log files per stage.
    *   Tracks LLM token usage and metrics.
    *   Updates stage-level progress in `tasks-status.json`.

### 4. LLM Abstraction Layer (`src/llm/index.js`, `src/providers/`)
The system provides a unified interface for interacting with various Large Language Models, decoupling task logic from specific providers.

*   **Unified Interface**: A common `chat()` function handles requests, normalizing parameters (messages, temperature, etc.) and responses.
*   **Supported Providers**:
    *   **OpenAI**: Standard `gpt-*` models.
    *   **DeepSeek**: Optimized for coding tasks.
    *   **Anthropic**: Claude models.
    *   **Gemini**: Google's multimodal models.
    *   **Moonshot**: Kimi models.
    *   **Zhipu**: GLM models.
    *   **Claude Code**: Integration with the `claude-code` CLI.
    *   **OpenCode**: Optional prompt runner via SDK client or CLI fallback. Runs POP prompt requests through OpenCode while POP retains orchestration ownership. See `.specs/299-opencode-backend-layer/spec.md`.
*   **Features**:
    *   **Cost & Usage Tracking**: Automatically calculates costs and normalizes token usage metrics across providers.
    *   **Metrics Events**: Emits `llm:request:complete` and `llm:request:error` events for observability.
    *   **Overrides**: Supports pipeline-level or task-level overrides to route requests to specific models or providers dynamically.

### 5. Pipeline Configuration (`demo/pipeline-config/`)
Pipelines are defined using a registry-based system that separates configuration from implementation.

*   **Registry (`registry.json`)**: Maps pipeline slugs (e.g., `content-generation`) to their configuration paths.
*   **Definition (`pipeline.json`)**: Defines the high-level structure of a pipeline:
    *   **Metadata**: Name, version, description.
    *   **Task List**: The ordered sequence of tasks. Entries can be strings or objects with `name`, optional shared `task` key, per-entry `config`, and optional declarative `gate`.
    *   **LLM Defaults**: Optional default provider/model settings for the entire pipeline.
*   **Task Mapping (`tasks/index.js`)**: Maps the logical task names used in `pipeline.json` to the actual JavaScript implementation files.

### 6. State Management (`src/core/status-writer.js`)
*   **Storage**: State is persisted in `tasks-status.json` within the job directory.
*   **Consistency**: Uses an atomic read-modify-write pattern with temporary files and renames to prevent data corruption.
*   **Run State**: Jobs may be `pending`, `running`, `waiting`, `done`, or `failed`; tasks may be `pending`, `running`, `done`, `failed`, or `skipped`.
*   **Gate State**: A waiting job stores a `gate` block with the task that requested review, the message, optional artifact links, and request time.
*   **Events**: Emits Server-Sent Events (SSE) (via `logger.sse`) when status changes, enabling real-time UI updates.
*   **Audit Lineage**: Run mutations are appended to `events.jsonl` as best-effort audit events. Recovery uses `tasks-status.json` plus the per-run `pipeline.json`, not event replay.

### 5. Configuration (`src/core/config.js`)
*   **Source**: Loads configuration from defaults, environment variables (`PO_*`), and config files.
*   **Registry**: Manages a registry of available pipelines, mapping slugs to their file system locations.

## Data Flow

1.  **Submission**: User/System drops `job-123-seed.json` into `pending/`.
2.  **Pickup**: Orchestrator detects file, moves it to `current/job-123/`.
3.  **Execution**: Orchestrator spawns a Bun runtime process for the pipeline runner and passes the job ID.
4.  **Processing**: Runner executes tasks. Task Runner executes stages.
5.  **Run Control**: A completed task may append tasks, skip pending work, or create a waiting gate through `control.json`.
6.  **Output**: Artifacts and logs are written to `current/job-123/files/`. Status is updated in `current/job-123/tasks-status.json`.
7.  **Completion**: Directory moved to `complete/job-123/`.

## Directory Structure

```text
pipeline-data/
├── pending/                # Incoming seeds
├── current/                # Active jobs
│   └── {jobId}/
│       ├── seed.json       # Input data
│       ├── pipeline.json   # Per-run pipeline definition
│       ├── tasks-status.json # Real-time state
│       ├── events.jsonl    # Best-effort run mutation audit log
│       ├── runner.pid      # Process ID for management
│       ├── tasks/          # Task-specific working dirs
│       └── files/          # Logs and artifacts
└── complete/               # Finished jobs
    ├── {jobId}/
    └── runs.jsonl          # Historical index
```
