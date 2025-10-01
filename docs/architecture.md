# Prompt Orchestration Pipeline - Architecture Documentation

## Overview

The Prompt Orchestration Pipeline is a sophisticated system for managing and executing multi-stage LLM-powered workflows. It provides a robust framework for orchestrating complex AI tasks with automatic refinement, multiple provider support, and real-time monitoring capabilities.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Entry Points                             │
├─────────────────┬───────────────────────┬──────────────────────┤
│   CLI (cli/)    │    API (api/)         │   UI Server (ui/)    │
└────────┬────────┴───────────┬───────────┴──────────┬───────────┘
         │                    │                      │
         └────────────────────┼──────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Orchestrator     │
                    │   (core/)          │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Pipeline Runner   │
                    │  (spawned process) │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Task Runner      │
                    │   (11-stage flow)  │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   LLM Layer        │
                    │   (llm/)           │
                    └─────────┬──────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
    │ OpenAI  │         │DeepSeek │         │Anthropic│
    │Provider │         │Provider │         │Provider │
    └─────────┘         └─────────┘         └─────────┘
```

## Core Components

### 1. CLI Layer (`src/cli/index.js`)

**Purpose**: Command-line interface for system interaction

**Key Commands**:

- `init` - Initialize pipeline configuration
- `start` - Start the orchestrator (with optional UI)
- `submit <seed-file>` - Submit a new job
- `status [job-name]` - Get job status

**Responsibilities**:

- Parse command-line arguments
- Initialize PipelineOrchestrator
- Handle user interactions
- Manage process lifecycle

**Potential Issues**:

- ⚠️ Limited error handling for malformed commands

### 2. API Layer (`src/api/index.js`)

**Purpose**: Functional API for programmatic access

**Architecture Pattern**: Functional programming with state management

**Key Functions**:

- `createPipelineOrchestrator(options)` - Main factory function
- `submitJob(state, seed)` - Submit new pipeline job
- `getStatus(state, jobName)` - Retrieve job status
- `listJobs(state, status)` - List jobs by status
- `start(state)` / `stop(state)` - Control orchestrator

**State Management**:

```javascript
state = {
  config, // Configuration options
  paths, // File system paths
  pipelineDefinition, // Pipeline configuration
  orchestrator, // Orchestrator instance
  uiServer, // Optional UI server
};
```

**Backward Compatibility**: Provides `PipelineOrchestrator` class-like API wrapper

**Potential Issues**:

- ⚠️ State object is mutable and passed around
- ⚠️ No validation of pipeline definition structure

### 3. Orchestrator (`src/core/orchestrator.js`)

**Purpose**: Manages pipeline lifecycle and job execution

**Key Responsibilities**:

1. Watch for new seed files in pending directory
2. Spawn isolated pipeline-runner processes for each job
3. Manage process lifecycle (start, monitor, cleanup)
4. Handle graceful and forced shutdown

**File System Structure**:

```
pipeline-data/
├── pending/        # Seed files awaiting processing
│   └── {name}-seed.json
├── current/        # Active pipeline executions
│   └── {name}/
│       ├── seed.json
│       ├── tasks-status.json
│       └── tasks/
└── complete/       # Finished pipelines
    └── {name}/
        └── (same structure as current)
```

**Process Management**:

- Uses `chokidar` for file watching
- Spawns Node.js child processes for isolation
- Implements lock files to prevent race conditions
- SIGTERM → 2s wait → SIGKILL shutdown strategy

### 4. Pipeline Runner (`src/core/pipeline-runner.js`)

**Purpose**: Execute individual pipeline jobs in isolated processes

**Execution Flow**:

1. Load pipeline definition and task registry
2. Read seed data and status
3. Execute tasks sequentially
4. Handle task failures and retries
5. Move completed pipeline to complete directory
6. Log execution metrics

**Environment Variables**:

- `PO_ROOT` - Root directory
- `PO_DATA_DIR` - Data directory path
- `PO_CURRENT_DIR` - Current jobs directory
- `PO_COMPLETE_DIR` - Completed jobs directory
- `PO_CONFIG_DIR` - Configuration directory
- `PO_PIPELINE_PATH` - Pipeline definition path
- `PO_TASK_REGISTRY` - Task registry path

**Artifacts Management**:

- `output.json` - Task output data
- `letter.json` - Task metadata
- `execution-logs.json` - Execution logs
- `runs.jsonl` - Append-only completion log

**Potential Issues**:

- ⚠️ Single point of failure - if runner crashes, job is lost
- ⚠️ No mechanism to resume interrupted pipelines

### 5. Task Runner (`src/core/task-runner.js`)

**Purpose**: Execute individual tasks through 11-stage pipeline with automatic refinement

**11-Stage Pipeline**:

```javascript
ORDER = [
  "ingestion", // Load and prepare input data
  "preProcessing", // Clean and transform data
  "promptTemplating", // Build LLM prompts
  "inference", // Call LLM
  "parsing", // Parse LLM response
  "validateStructure", // Validate output structure
  "validateQuality", // Validate output quality
  "critique", // Generate improvement suggestions
  "refine", // Apply refinements
  "finalValidation", // Final quality check
  "integration", // Integrate results
];
```

**Refinement Logic**:

- Automatic refinement on validation failure
- Max 2 refinement attempts
- Pre-validation refinement on subsequent cycles
- Skips ingestion/preProcessing on refinement cycles

**Context Flow**:

```javascript
context = {
  workDir, // Working directory
  taskDir, // Task-specific directory
  seed, // Initial seed data
  artifacts, // Previous task outputs
  taskName, // Current task name
  currentStage, // Current stage name
  llm, // LLM interface
  envLoaded, // Environment loaded flag
  validationFailed, // Validation failure flag
  refined, // Refinement applied flag
  lastValidationError, // Last validation error
};
```

**LLM Metrics Collection**:

- Tracks all LLM requests via event emitter
- Records task, stage, duration, tokens, cost
- Aggregates metrics per pipeline run

### 6. Environment Management (`src/core/environment.js`)

**Purpose**: Load and validate environment configuration

**Supported Providers**:

- OpenAI (API key, organization, base URL)
- Anthropic (API key, base URL)
- DeepSeek (API key)
- Gemini (API key, base URL)

**Functions**:

- `loadEnvironment(options)` - Load .env files
- `validateEnvironment()` - Check for API keys
- `getEnvironmentConfig()` - Get provider configs

**Potential Issues**:

- ⚠️ Only warns about missing API keys, doesn't enforce
- ⚠️ Loads .env.local after .env (override behavior not documented)

### 7. LLM Integration Layer (`src/llm/index.js`)

**Purpose**: Unified interface for multiple LLM providers

**Key Features**:

- Provider abstraction
- Event-based metrics collection
- Token estimation
- Cost calculation
- Retry logic
- Parallel execution support

**Event System**:

```javascript
Events:
- llm:request:start    // Request initiated
- llm:request:complete // Request succeeded
- llm:request:error    // Request failed
```

**API Functions**:

- `chat(options)` - Main chat interface
- `complete(prompt, options)` - Simple completion
- `createChain()` - Multi-turn conversations
- `withRetry(fn, args, maxRetries)` - Retry wrapper
- `parallel(fn, items, maxConcurrency)` - Parallel execution
- `createLLM(options)` - Bound LLM interface

**Potential Issues**:

- ⚠️ Parallel execution doesn't handle partial failures well

### 8. Provider Implementations

#### Base Provider (`src/providers/base.js`)

**Shared Utilities**:

- `extractMessages(messages)` - Parse message arrays
- `isRetryableError(err)` - Determine if error is retryable
- `sleep(ms)` - Async sleep
- `tryParseJSON(text)` - Robust JSON parsing with fallbacks

**JSON Parsing Strategy**:

1. Try direct JSON.parse
2. Strip markdown code blocks
3. Extract first complete JSON object/array

#### OpenAI Provider (`src/providers/openai.js`)

**Dual API Support**:

- **Responses API** (GPT-5 models) - New structured output API
- **Chat Completions API** (GPT-4 and earlier) - Classic API

**Key Features**:

- Automatic API selection based on model
- Fallback from Responses to Chat Completions
- JSON schema support
- Tool calling support
- Retry with exponential backoff

**Functions**:

- `openaiChat(options)` - Main unified interface
- `queryChatGPT(system, prompt, options)` - Legacy helper

**Potential Issues**:

- ⚠️ Responses API fallback logic may cause confusion
- ⚠️ Token usage estimation for GPT-5 (not returned by API)
- ⚠️ Default temperature differs between APIs (0.7 for classic)

#### DeepSeek Provider (`src/providers/deepseek.js`)

**Implementation**: Direct fetch to DeepSeek API

**Features**:

- JSON response format support
- Retry logic
- Usage tracking

#### Provider Architecture

**Note**: The legacy `src/providers/index.js` file has been removed (see `docs/providers-fix.md` for details).

**Current Structure**:

- `src/llm/index.js` - Canonical LLM abstraction layer
- `src/providers/` - Individual provider implementations
  - `base.js` - Shared utilities
  - `openai.js` - OpenAI implementation
  - `deepseek.js` - DeepSeek implementation
  - `anthropic.js` - Anthropic implementation

**Documentation**: See `src/llm/README.md` for complete API reference

### 9. UI System

#### UI Server (`src/ui/server.js`)

**Purpose**: HTTP server for real-time pipeline monitoring

**Architecture**: Single Node.js HTTP server

**Endpoints**:

- `GET /` - Serve UI HTML
- `GET /api/state` - Get current state (JSON)
- `GET /api/events` - Server-Sent Events stream

**Features**:

- Static file serving
- SSE for real-time updates
- Heartbeat to keep connections alive
- CORS support

#### UI State (`src/ui/state.js`)

**Purpose**: In-memory state management

**State Structure**:

```javascript
{
  updatedAt: ISO timestamp,
  changeCount: number,
  recentChanges: [
    { path, type, timestamp }
  ],
  watchedPaths: [paths]
}
```

**Potential Issues**:

- ⚠️ State is global and mutable
- ⚠️ No persistence - lost on restart
- ⚠️ Limited to 10 recent changes

#### UI Watcher (`src/ui/watcher.js`)

**Purpose**: File system change detection

**Features**:

- Chokidar-based watching
- Debounced change batching (200ms)
- Ignores .git, node_modules, dist

## Data Flow

### Job Submission Flow

```
1. User submits seed file
   ↓
2. API writes to pending/{name}-seed.json
   ↓
3. Orchestrator detects new file (chokidar)
   ↓
4. Orchestrator creates lock file
   ↓
5. Orchestrator creates current/{name}/ directory
   ↓
6. Orchestrator writes seed.json and tasks-status.json
   ↓
7. Orchestrator spawns pipeline-runner process
   ↓
8. Pipeline-runner loads task modules
   ↓
9. For each task in pipeline:
   a. Update status to "running"
   b. Execute task through 11-stage runner
   c. Save output.json
   d. Update status to "done"
   ↓
10. Move current/{name}/ to complete/{name}/
    ↓
11. Append to runs.jsonl
```

### Task Execution Flow

```
1. Load task module
   ↓
2. Initialize context with seed + artifacts
   ↓
3. Execute stages in order:
   - ingestion
   - preProcessing
   - promptTemplating
   - inference (LLM call)
   - parsing
   - validateStructure
   ↓
4. If validation fails:
   a. Run critique stage
   b. Run refine stage
   c. Retry from promptTemplating
   d. Max 2 refinement cycles
   ↓
5. Continue remaining stages:
   - validateQuality
   - finalValidation
   - integration
   ↓
6. Return result with logs and metrics
```

### LLM Request Flow

```
1. Task calls context.llm.chat(options)
   ↓
2. LLM layer emits "llm:request:start"
   ↓
3. Route to appropriate provider:
   - OpenAI → openaiChat()
   - DeepSeek → deepseekChat()
   - Anthropic → anthropicChat()
   ↓
4. Provider makes API call with retry logic
   ↓
5. Parse response (JSON if requested)
   ↓
6. Calculate tokens and cost
   ↓
7. LLM layer emits "llm:request:complete"
   ↓
8. Task runner records metrics
   ↓
9. Return response to task
```

## Configuration

### Pipeline Definition (`pipeline-config/pipeline.json`)

```json
{
  "name": "my-pipeline",
  "version": "1.0.0",
  "tasks": ["task1", "task2", "task3"]
}
```

### Task Registry (`pipeline-config/tasks/index.js`)

```javascript
export default {
  task1: "./task1/index.js",
  task2: "./task2/index.js",
  task3: "./task3/index.js",
};
```

### Task Module Structure

```javascript
// Each task exports functions for pipeline stages
export async function ingestion(context) {
  // Load data
  return { data: ... };
}

export async function inference(context) {
  // Call LLM
  const response = await context.llm.chat({...});
  return { output: response.content };
}

export async function validateStructure(context) {
  // Validate output
  if (!valid) {
    context.validationFailed = true;
  }
}

export async function critique(context) {
  // Generate improvement suggestions
  return { critique: ... };
}

export async function refine(context) {
  // Apply refinements
  return { refined: true };
}
```

## Critical Issues Identified

### 1. Code Duplication

- ✅ **RESOLVED**: Removed duplicate `src/providers/index.js` file
- All LLM abstraction now consolidated in `src/llm/index.js`
- See `docs/providers-fix.md` for resolution details

### 2. Error Handling

- Insufficient error recovery in orchestrator
- No retry mechanism for failed process spawns
- Pipeline runner exits immediately on task failure
- **Recommendation**: Implement comprehensive error recovery strategy

### 3. State Management

- Mutable state passed around in API layer
- No transaction safety for file operations
- No mechanism to resume interrupted pipelines
- **Recommendation**: Implement immutable state patterns and transaction logs

### 4. Process Isolation

- Environment variables could conflict in multi-instance scenarios
- Lock file mechanism fragile
- **Recommendation**: Use proper IPC or message queues

### 5. Security

- No authentication on UI server
- No input validation on seed files
- No rate limiting
- **Recommendation**: Add authentication, validation, and rate limiting

### 6. Scalability

- Single orchestrator instance
- No distributed execution support
- In-memory state only
- **Recommendation**: Design for horizontal scaling

### 7. Observability

- Limited logging
- No distributed tracing
- Metrics collection incomplete
- **Recommendation**: Implement structured logging and tracing

### 8. Configuration

- Hard-coded values throughout (timeouts, limits, paths)
- No schema validation for pipeline definitions
- **Recommendation**: Centralize configuration with validation

## Strengths

1. **Clean Separation of Concerns**: Well-organized module structure
2. **Functional API Design**: Immutable-friendly patterns in API layer
3. **Automatic Refinement**: Intelligent retry logic with critique/refine cycle
4. **Multi-Provider Support**: Flexible LLM provider abstraction
5. **Real-Time Monitoring**: SSE-based UI updates
6. **Process Isolation**: Each pipeline runs in separate process
7. **Comprehensive Testing**: Good test coverage across components

## Recommendations

### Immediate (High Priority)

1. ✅ ~~Remove duplicate `src/providers/index.js`~~ (Completed)
2. Add input validation for seed files
3. Implement proper error recovery in orchestrator
4. Add authentication to UI server

### Short Term

1. Make configuration values configurable
2. Add schema validation for pipeline definitions
3. Implement transaction safety for file operations
4. Add structured logging

### Long Term

1. Design for horizontal scaling
2. Implement distributed tracing
3. Add support for pipeline resumption
4. Consider message queue for job distribution
5. Implement proper state persistence

## Conclusion

The Prompt Orchestration Pipeline is a well-architected system with strong foundations in functional programming and process isolation. The 11-stage pipeline with automatic refinement is particularly innovative. However, there are critical issues around code duplication, error handling, and scalability that should be addressed. The system would benefit from more robust error recovery, better observability, and preparation for distributed execution.
