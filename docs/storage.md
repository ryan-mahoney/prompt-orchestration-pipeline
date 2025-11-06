# Prompt Orchestration Pipeline - Storage Documentation

## Overview

This document describes the data storage architecture and file formats used by the Prompt Orchestration Pipeline. The system uses a file-based storage approach with clear directory structures and JSON-based file formats for managing pipeline execution, task results, and job lifecycle.

## Directory Structure

### Core Storage Directories

```
demo/
├── seeds/                          # Input seed files
│   ├── market-analysis.json
│   ├── content-generation.json
│   └── data-processing.json
├── pipeline-config/                # Pipeline configuration
│   ├── pipeline.json
│   └── tasks/
│       ├── index.js
│       ├── research/
│       ├── analysis/
│       ├── synthesis/
│       └── formatting/
└── pipeline-data/                  # Runtime data
    ├── pending/                    # Jobs awaiting processing
    ├── current/                    # Active pipeline executions
    ├── complete/                   # Completed pipelines
    └── rejected/                   # Rejected pipelines
```

### Runtime Data Directory Structure

```
pipeline-data/
├── pending/
│   └── {jobId}-seed.json           # Seed files awaiting processing
├── current/
│   └── {jobId}/                    # Active pipeline directory
│       ├── seed.json               # Original seed data
│       ├── tasks-status.json       # Execution status tracking + file index
│       ├── files/                  # Actual on-disk files live here (source of truth)
│       │   ├── artifacts/          # Created via context.files.writeArtifact()
│       │   ├── logs/               # Created via context.files.writeLog()
│       │   └── tmp/                # Created via context.files.writeTmp()
│       └── tasks/                  # Task execution directories (legacy files below)
│           └── {task-name}/
│               ├── output.json     # Legacy task results (deprecated)
│               └── execution-logs.json # Execution logs
├── complete/
│   └── {jobId}/                    # Completed pipeline directory
│       ├── seed.json
│       ├── tasks-status.json
│       ├── files/                  # Actual on-disk files
│       │   ├── artifacts/
│       │   ├── logs/
│       │   └── tmp/
│       └── tasks/
│           └── {task-name}/
│               ├── output.json     # Legacy task results (deprecated)
│               └── execution-logs.json # Execution logs
└── rejected/                       # Rejected pipelines
```

## File Types and Formats

### 1. Seed Files (`seeds/*.json`)

**Purpose**: Define input data and configuration for pipeline jobs.

**Location**: `demo/seeds/`

**Schema**:

```json
{
  "name": "job-name",
  "pipeline": "pipeline-slug",
  "data": {
    "type": "workflow-type",
    "industry": "Industry name",
    "region": "Geographic region",
    "timeframe": "Time period",
    "focusAreas": ["Area 1", "Area 2"],
    "outputFormat": "desired-output-format"
  }
}
```

**Required fields**:

- `name`: Unique identifier for the job (alphanumeric, hyphens, and underscores only)
- `pipeline`: Valid pipeline slug from `pipeline-config/registry.json`
- `data`: Object containing the input data for the pipeline

**Examples**:

**Market Analysis Seed** (`market-analysis.json`):

```json
{
  "name": "market-analysis",
  "pipeline": "content",
  "data": {
    "type": "market-research",
    "industry": "Renewable Energy Storage",
    "region": "North America",
    "timeframe": "2024-2025",
    "focusAreas": [
      "Market size and growth",
      "Key players and competition",
      "Technology trends",
      "Regulatory landscape"
    ],
    "outputFormat": "executive-summary"
  }
}
```

**Content Generation Seed** (`content-generation.json`):

```json
{
  "name": "content-generation",
  "pipeline": "content",
  "data": {
    "type": "content-creation",
    "topic": "AI-Powered Development Tools",
    "contentType": "blog-post",
    "targetAudience": "software-developers",
    "tone": "professional-yet-accessible",
    "length": "1500-2000 words",
    "keywords": ["AI", "developer tools", "productivity", "automation"],
    "outputFormat": "blog-post"
  }
}
```

**Data Processing Seed** (`data-processing.json`):

```json
{
  "name": "data-processing",
  "pipeline": "content",
  "data": {
    "type": "data-extraction",
    "sourceType": "unstructured-text",
    "dataPoints": [
      "company names",
      "funding amounts",
      "investment dates",
      "investor names",
      "industry sectors"
    ],
    "outputFormat": "structured-json",
    "sampleText": "In Q1 2024, TechCorp raised $50M in Series B funding..."
  }
}
```

### 2. Pipeline Configuration (`pipeline-config/pipeline.json`)

**Purpose**: Define task sequence and model configurations.

**Location**: `pipeline-config/content/pipeline.json`

**Schema**:

```json
{
  "name": "pipeline-name",
  "version": "1.0.0",
  "description": "Pipeline description",
  "tasks": [
    {
      "id": "task1",
      "name": "task1",
      "config": { "model": "model-name", "temperature": 0.7, "maxTokens": 2000 }
    },
    {
      "id": "task2",
      "name": "task2",
      "config": { "model": "model-name", "temperature": 0.5, "maxTokens": 1500 }
    },
    {
      "id": "task3",
      "name": "task3",
      "config": { "model": "model-name", "temperature": 0.3, "maxTokens": 2000 }
    }
  ],
  "metadata": {
    "author": "Author name",
    "created": "creation-date",
    "tags": ["tag1", "tag2"]
  }
}
```

See also: `docs/tasks-data-shape.md` — canonical Task[] schema and migration guidance.

**Example**:

```json
{
  "name": "demo-pipeline",
  "version": "1.0.0",
  "description": "Demo pipeline showcasing multi-stage LLM workflows",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "taskConfig": {
    "research": {
      "model": "gpt-5-nano",
      "temperature": 0.7,
      "maxTokens": 2000
    },
    "analysis": {
      "model": "gpt-5-nano",
      "temperature": 0.6,
      "maxTokens": 2500
    },
    "synthesis": {
      "model": "gpt-5-nano",
      "temperature": 0.8,
      "maxTokens": 3000
    },
    "formatting": {
      "model": "gpt-5-nano",
      "temperature": 0.3,
      "maxTokens": 2000
    }
  },
  "metadata": {
    "author": "Prompt Orchestration Pipeline",
    "created": "2024-01-01",
    "tags": ["demo", "example", "reference"]
  }
}
```

### 3. Task Registry (`pipeline-config/tasks/index.js`)

**Purpose**: Map task names to their implementation modules.

**Location**: `pipeline-config/content/tasks/index.js`

**Format**: JavaScript module exports

```javascript
export default {
  "task-name": "./task-name/index.js",
  research: "./research/index.js",
  analysis: "./analysis/index.js",
  synthesis: "./synthesis/index.js",
  formatting: "./formatting/index.js",
};
```

### 4. Task Status Files (`tasks-status.json`)

**Purpose**: Track execution state of all tasks in a pipeline with real-time stage progress tracking.

**Location**: `{job-directory}/tasks-status.json`

**⚠️ Important**: This schema is **non-backward-compatible**. The status document is the single source of truth for current stage information and does not support legacy formats.

**Schema**:

```json
{
  "id": "unique-pipeline-id",
  "name": "job-name",
  "current": "current-task-name-or-null",
  "currentStage": "current-stage-id-or-null",
  "state": "pending|running|done|failed",
  "createdAt": "ISO-timestamp",
  "lastUpdated": "ISO-timestamp",
  "files": {
    "artifacts": ["file1.json", "file2.json"],
    "logs": ["process.log", "debug.log"],
    "tmp": ["temp-data.json"]
  },
  "tasks": {
    "task-name": {
      "state": "pending|running|done|failed",
      "currentStage": "current-stage-id-or-null",
      "failedStage": "stage-id-if-failed-or-null",
      "startedAt": "ISO-timestamp",
      "attempts": 1,
      "endedAt": "ISO-timestamp",
      "files": {
        "artifacts": ["output.json", "result.json"],
        "logs": ["execution.log"],
        "tmp": ["temp-file.json"]
      },
      "artifacts": ["output.json", "execution-logs.json"],
      "executionTime": 12345.67,
      "refinementAttempts": 0
    }
  }
}
```

**Real-Time Stage Tracking**:

The status file provides atomic, synchronous updates at stage boundaries:

- **While task is running**:
  - `current` points to the active `taskId`
  - `currentStage` points to the active `stageId`
  - `tasks[taskId].currentStage` matches `currentStage`
  - `tasks[taskId].state` is `"running"`

- **On successful stage completion**:
  - Both root `currentStage` and per-task `currentStage` update synchronously
  - `lastUpdated` timestamp is set
  - SSE `state:change` event is emitted

- **On task success**:
  - `tasks[taskId].state` becomes `"done"`
  - Root `current`/`currentStage` advance to next task or clear if pipeline finished
  - Root `state` remains `"pending"` (or `"done"` when all tasks complete)

- **On task failure**:
  - `tasks[taskId].state` becomes `"failed"`
  - `tasks[taskId].failedStage` is set to the failing `stageId`
  - Root `state` becomes `"failed"`
  - Root `current`/`currentStage` retain the failing task/stage until recovery

**Atomic Updates and SSE**:

- All writes to `tasks-status.json` are performed atomically using temp-file + rename
- Every write is immediately followed by an SSE `state:change` event with `payload.path` ending in `/tasks-status.json`
- UI components rely exclusively on this file for stage information (no execution-log dependency)

**Field Descriptions**:

- `current`: Currently executing task ID, or `null` when no task is active
- `currentStage`: Currently executing stage ID within the current task, or `null`
- `state`: Overall pipeline state - **reflects failures immediately** (`"failed"` when any task fails)
- `tasks[taskId].currentStage`: Stage ID currently executing for this task, or `null`
- `tasks[taskId].failedStage`: Stage ID where this task failed, or `null`
- `lastUpdated`: ISO timestamp of the most recent status update

**Example**:

```json
{
  "id": "pl-2025-10-02T06-37-29-980Z-0d57ec",
  "name": "content-generation",
  "current": "formatting",
  "createdAt": "2025-10-02T06:37:29.984Z",
  "files": {
    "artifacts": [
      "research-output.json",
      "analysis-result.json",
      "synthesis-draft.json",
      "final-content.json"
    ],
    "logs": ["research.log", "analysis.log", "synthesis.log", "formatting.log"],
    "tmp": ["temp-research.json", "temp-analysis.json"]
  },
  "tasks": {
    "research": {
      "state": "done",
      "startedAt": "2025-10-02T06:37:30.061Z",
      "attempts": 1,
      "endedAt": "2025-10-02T06:37:48.245Z",
      "files": {
        "artifacts": ["research-output.json"],
        "logs": ["research.log"],
        "tmp": ["temp-research.json"]
      },
      "artifacts": ["output.json", "execution-logs.json"],
      "executionTime": 18176.66,
      "refinementAttempts": 0
    },
    "analysis": {
      "state": "done",
      "startedAt": "2025-10-02T06:37:48.245Z",
      "attempts": 1,
      "endedAt": "2025-10-02T06:38:00.160Z",
      "files": {
        "artifacts": ["analysis-result.json"],
        "logs": ["analysis.log"],
        "tmp": ["temp-analysis.json"]
      },
      "artifacts": ["output.json", "execution-logs.json"],
      "executionTime": 11910.35,
      "refinementAttempts": 0
    }
  }
}
```

**New files.\* Schema**:

The `files` object provides structured tracking of files created through the `context.files` API:

- **files.artifacts**: Array of artifact filenames created via `context.files.writeArtifact()`
- **files.logs**: Array of log filenames created via `context.files.writeLog()`
- **files.tmp**: Array of temporary filenames created via `context.files.writeTmp()`

This schema exists at both:

- **Job level**: `files` object contains all files across all tasks
- **Task level**: `tasks.{taskName}.files` object contains files for that specific task

**Legacy artifacts field**: The `artifacts` array is maintained for backward compatibility but is deprecated.

Important: On-disk files vs index in tasks-status.json

- All physical files created via the `context.files` API are written under `{jobId}/files/(artifacts|logs|tmp)` on disk. This job-level `files/` folder is the single source of truth for file storage.
- `tasks-status.json` maintains both job-level `files.*` arrays and per-task `tasks.{taskName}.files.*` arrays. These arrays act as an index for filtering which filenames to show for a given step; they do not change where files live.
- When listing files for a task, the UI/API reads `tasks.{taskName}.files.*` and resolves those filenames relative to `{jobId}/files/...`. The on-disk layout always remains under `{jobId}/files/`.

### 5. Task Output Files (`output.json`)

**Purpose**: Store results from individual task execution.

**Location**: `{job-directory}/tasks/{task-name}/output.json`

**Schema**:

```json
{
  "task-name": {
    "content": "task-output-content",
    "metadata": {},
    "timestamp": "ISO-timestamp"
  }
}
```

**Example** (Research task output):

```json
{
  "research": {
    "content": "{\"content\":\"\",\"text\":\"\",\"usage\":{\"prompt_tokens\":56,\"completion_tokens\":0,\"total_tokens\":56},\"raw\":{\"id\":\"resp_01357a7a2defce6d0068de1daa44d8819989b9828976529ac2\",\"object\":\"response\",\"created_at\":1759387050,\"status\":\"incomplete\",\"background\":false,\"billing\":{\"payer\":\"developer\"},\"error\":null,\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"instructions\":\"You are a research assistant specializing in comprehensive information gathering.\",\"max_output_tokens\":2000,\"max_tool_calls\":null,\"model\":\"gpt-5-nano-2025-08-07\",\"output\":[{\"id\":\"rs_01357a7a2defce6d0068de1dab84dc8199b1662bdc03d51add\",\"type\":\"reasoning\",\"summary\":[]}],\"parallel_tool_calls\":true,\"previous_response_id\":null,\"prompt_cache_key\":null,\"reasoning\":{\"effort\":\"medium\",\"summary\":null},\"safety_identifier\":null,\"service_tier\":\"default\",\"store\":true,\"temperature\":1,\"text\":{\"format\":{\"type\":\"text\"},\"verbosity\":\"medium\"},\"tool_choice\":\"auto\",\"tools\":[],\"top_logprobs\":0,\"top_p\":1,\"truncation\":\"disabled\",\"usage\":{\"input_tokens\":45,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":1984,\"output_tokens_details\":{\"reasoning_tokens\":1984},\"total_tokens\":2029},\"user\":null,\"metadata\":{},\"output_text\":\"\"}}",
    "metadata": {},
    "timestamp": "2025-10-02T06:37:48.243Z"
  }
}
```

### 6. Execution Logs (`execution-logs.json`)

**Purpose**: Store detailed execution logs for debugging and monitoring.

**Location**: `{job-directory}/tasks/{task-name}/execution-logs.json`

**Schema**: Array of log entries with timestamps, levels, and messages.

### 7. Completion Log (`runs.jsonl`)

**Purpose**: Append-only log of completed pipeline runs.

**Location**: `pipeline-data/complete/runs.jsonl`

**Format**: JSON Lines (one JSON object per line)

**Schema**:

```json
{
  "name": "job-name",
  "id": "unique-pipeline-id",
  "finishedAt": "ISO-timestamp",
  "tasks": ["task1", "task2", "task3"],
  "totalExecutionTime": 12345.67,
  "totalRefinementAttempts": 0,
  "finalArtifacts": ["task1", "task2", "task3"]
}
```

**Example**:

```json
{
  "name": "content-generation",
  "id": "pl-2025-10-02T06-37-29-980Z-0d57ec",
  "finishedAt": "2025-10-02T06:38:32.232Z",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "totalExecutionTime": 62143.21,
  "totalRefinementAttempts": 0,
  "finalArtifacts": ["research", "analysis", "synthesis", "formatting"]
}
```

## Data Lifecycle

### 1. Job Submission

- User creates seed file in `seeds/` directory
- System copies seed to `pending/{jobId}-seed.json`

### 2. Job Processing

- Orchestrator detects new pending seed
- Creates directory in `current/{jobId}/`
- Copies seed to `current/{jobId}/seed.json`
- Creates initial `tasks-status.json`
- Spawns pipeline-runner process

### 3. Task Execution

- For each task in pipeline:
  - Updates task state in `tasks-status.json`
  - Creates task directory `tasks/{task-name}/`
  - Executes task through 11-stage pipeline
  - Saves results to `output.json`
  - Saves logs to `execution-logs.json`
  - Updates task state to "done"

### 4. Job Completion

- All tasks complete successfully
- Moves `current/{jobId}/` to `complete/{jobId}/`
- Appends completion record to `runs.jsonl`

### 5. Job Failure

- Task fails validation or encounters error
- May trigger refinement cycles (max 2 attempts)
- If all refinement fails, job may be moved to `rejected/`

## File Naming Conventions

- **Seed files**: `{job-name}.json` (in seeds/) → `{jobId}-seed.json` (in pending/)
- **Job directories**: `{jobId}/` (in current/ and complete/)
- **Task directories**: `{task-name}/` (within job directories)
- **Pipeline IDs**: `pl-{timestamp}-{random-suffix}` format

## Storage Best Practices

### 1. File Organization

- Keep seed files organized by use case or workflow type
- Use descriptive job names that indicate purpose
- Maintain consistent directory structure across environments

### 2. Data Retention

- `pending/` directory should be regularly cleaned
- `complete/` directory may accumulate over time
- Consider archiving or deleting old completed jobs
- `runs.jsonl` provides audit trail for completed jobs

### 3. Backup Strategy

- Pipeline configuration files should be version controlled
- Runtime data directories may contain large files
- Consider excluding `pipeline-data/` from version control
- Implement regular backups for critical data

### 4. Security Considerations

- Seed files may contain sensitive business data
- Task outputs may contain proprietary information
- Implement access controls for storage directories
- Consider encryption for sensitive data at rest

## Integration with Architecture

The storage system integrates with the pipeline architecture as follows:

- **Orchestrator**: Monitors `pending/` directory and manages job lifecycle
- **Pipeline Runner**: Reads from `current/{job}/` and writes task results
- **Task Runner**: Executes individual tasks and saves outputs
- **UI Server**: Reads from storage to display job status and results
- **API Layer**: Provides programmatic access to storage operations

## Real-Time Updates via Server-Sent Events (SSE)

### SSE Filtering for Stage Updates

The UI automatically updates when `tasks-status.json` changes for the currently viewed job. This is achieved through Server-Sent Events (SSE) with intelligent filtering that ensures reliable real-time updates.

#### SSE Event Types

The system emits SSE events for file system changes, with `state:change` events being the primary mechanism for task status updates.

#### Path-Based Filtering

**Rule**: Any `state:change` event with `payload.path` pointing to the job's `tasks-status.json` triggers a debounced refetch, regardless of whether an `id` is present in the payload.

**Matching Pattern**: `^/?pipeline-data/(current|complete|pending|rejected)/{jobId}/tasks-status\.json$`

**Path Normalization**:

- Leading slashes are ignored (`/pipeline-data/...` == `pipeline-data/...`)
- Windows backslashes are converted to forward slashes (`pipeline-data\\...` → `pipeline-data/...`)
- Whitespace is trimmed from paths

**Lifecycle Support**: The pattern matches all pipeline lifecycle directories:

- `current/` - Active pipeline executions
- `complete/` - Completed pipelines
- `pending/` - Jobs awaiting processing
- `rejected/` - Rejected pipelines

#### Debouncing

Rapid file changes are debounced to prevent excessive API calls:

- Multiple `state:change` events within the debounce window result in a single refetch
- Default debounce delay: 200ms (configurable via `REFRESH_DEBOUNCE_MS`)
- Ensures UI updates efficiently without overwhelming the server

#### Event Handling Logic

1. **Path Matching**: Event path is normalized and matched against the job's `tasks-status.json`
2. **Debounced Refetch**: Matching events schedule a debounced refetch of job data
3. **State Update**: Refetched data updates the UI with current task and stage information
4. **Error Handling**: Malformed events are logged but don't crash the SSE connection

#### Example SSE Events

**Matching Event** (triggers refetch):

```json
{
  "type": "state:change",
  "payload": {
    "path": "pipeline-data/current/job123/tasks-status.json",
    "type": "modified"
  }
}
```

**Non-Matching Event** (ignored):

```json
{
  "type": "state:change",
  "payload": {
    "path": "pipeline-data/current/different-job/tasks-status.json",
    "type": "modified"
  }
}
```

**Path Variations** (all match after normalization):

- `pipeline-data/current/job123/tasks-status.json`
- `/pipeline-data/current/job123/tasks-status.json`
- `pipeline-data\\current\\job123\\tasks-status.json` (Windows)
- `  pipeline-data/current/job123/tasks-status.json  ` (with whitespace)

#### Implementation Notes

- The filtering logic is implemented in `src/ui/client/hooks/useJobDetailWithUpdates.js`
- Legacy behavior requiring `!id` for refetch has been removed
- Future-proof design allows for data-rich events while maintaining path-based refetching
- All path matching is case-sensitive and follows the exact pattern shown above

This SSE filtering approach ensures that:

1. **Immediate Updates**: UI reflects stage changes within debounce + network latency
2. **Reliable Filtering**: Only relevant job status changes trigger updates
3. **Cross-Platform**: Works consistently across different operating systems
4. **Efficient**: Debouncing prevents unnecessary API calls during burst activity
5. **Robust**: Graceful handling of malformed events and edge cases

## Integration with Architecture

The storage system integrates with the pipeline architecture as follows:

- **Orchestrator**: Monitors `pending/` directory and manages job lifecycle
- **Pipeline Runner**: Reads from `current/{job}/` and writes task results
- **Task Runner**: Executes individual tasks and saves outputs
- **UI Server**: Reads from storage to display job status and results
- **API Layer**: Provides programmatic access to storage operations
- **SSE System**: Emits real-time events for file changes with intelligent filtering

This file-based storage approach provides:

- **Transparency**: All data is human-readable JSON
- **Durability**: File system provides persistence
- **Auditability**: Complete execution history is preserved
- **Flexibility**: Easy to inspect, debug, and modify
- **Portability**: No database dependencies
- **Real-Time Updates**: SSE filtering ensures UI stays synchronized with execution state
