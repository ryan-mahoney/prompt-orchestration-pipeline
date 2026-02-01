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
    3.  Initializes the job status file (`tasks-status.json`).
    4.  Spawns a **Pipeline Runner** process.
*   **Concurrency**: Maintains a registry of running child processes.

### 2. Pipeline Runner (`src/core/pipeline-runner.js`)
The **Pipeline Runner** is an ephemeral process spawned for a single job execution.

*   **Responsibility**: Executes a specific pipeline definition for a specific job.
*   **Process**:
    1.  **Initialization**: Loads `seed.json` and the corresponding `pipeline.json` configuration.
    2.  **Validation**: Validates the pipeline structure.
    3.  **Task Loop**: Iterates through the defined tasks in order.
        *   Checks upstream dependencies (previous tasks must be `DONE`).
        *   Evaluates lifecycle policies (e.g., stopping if paused).
        *   Prepares the task environment (creating directories, validating symlinks).
        *   Delegates execution to the **Task Runner**.
    4.  **Completion**: Upon success, moves the job directory from `current/` to `complete/` and logs the run to `runs.jsonl`.
*   **Isolation**: Runs in its own process, ensuring that a crash in one pipeline does not affect the orchestrator or other jobs.

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
*   **Features**:
    *   **Cost & Usage Tracking**: Automatically calculates costs and normalizes token usage metrics across providers.
    *   **Metrics Events**: Emits `llm:request:complete` and `llm:request:error` events for observability.
    *   **Overrides**: Supports pipeline-level or task-level overrides to route requests to specific models or providers dynamically.

### 5. Pipeline Configuration (`demo/pipeline-config/`)
Pipelines are defined using a registry-based system that separates configuration from implementation.

*   **Registry (`registry.json`)**: Maps pipeline slugs (e.g., `content-generation`) to their configuration paths.
*   **Definition (`pipeline.json`)**: Defines the high-level structure of a pipeline:
    *   **Metadata**: Name, version, description.
    *   **Task List**: The ordered sequence of tasks (e.g., `["research", "analysis", "synthesis"]`).
    *   **LLM Defaults**: Optional default provider/model settings for the entire pipeline.
*   **Task Mapping (`tasks/index.js`)**: Maps the logical task names used in `pipeline.json` to the actual JavaScript implementation files.

### 6. State Management (`src/core/status-writer.js`)
*   **Storage**: State is persisted in `tasks-status.json` within the job directory.
*   **Consistency**: Uses an atomic read-modify-write pattern with temporary files and renames to prevent data corruption.
*   **Events**: Emits Server-Sent Events (SSE) (via `logger.sse`) when status changes, enabling real-time UI updates.

### 5. Configuration (`src/core/config.js`)
*   **Source**: Loads configuration from defaults, environment variables (`PO_*`), and config files.
*   **Registry**: Manages a registry of available pipelines, mapping slugs to their file system locations.

## Data Flow

1.  **Submission**: User/System drops `job-123-seed.json` into `pending/`.
2.  **Pickup**: Orchestrator detects file, moves it to `current/job-123/`.
3.  **Execution**: Orchestrator spawns `node pipeline-runner.js job-123`.
4.  **Processing**: Runner executes tasks. Task Runner executes stages.
5.  **Output**: Artifacts and logs are written to `current/job-123/files/`. Status is updated in `current/job-123/tasks-status.json`.
6.  **Completion**: Directory moved to `complete/job-123/`.

## Directory Structure

```text
pipeline-data/
├── pending/                # Incoming seeds
├── current/                # Active jobs
│   └── {jobId}/
│       ├── seed.json       # Input data
│       ├── tasks-status.json # Real-time state
│       ├── runner.pid      # Process ID for management
│       ├── tasks/          # Task-specific working dirs
│       └── files/          # Logs and artifacts
└── complete/               # Finished jobs
    ├── {jobId}/
    └── runs.jsonl          # Historical index
```
