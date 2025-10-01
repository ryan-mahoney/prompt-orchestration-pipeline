# Architecture Fix Plan - Prompt Orchestration Pipeline

## Executive Summary

This document outlines a comprehensive multi-step plan to address all issues identified in `docs/architecture.md`. The plan is organized by priority (Immediate, Short Term, Long Term) and includes specific action items, implementation details, and success criteria.

## Issues Summary

### Already Resolved

- ✅ **Code Duplication**: Removed duplicate `src/providers/index.js` (see `docs/providers-fix.md`)

### Outstanding Issues

1. **Error Handling** - Insufficient error recovery and retry mechanisms
2. **State Management** - Mutable state and lack of transaction safety
3. **Process Isolation** - Environment variable conflicts and fragile locking
4. **Security** - No authentication, validation, or rate limiting
5. **Scalability** - Single instance, no distributed execution
6. **Observability** - Limited logging and metrics
7. **Configuration** - Hard-coded values and no schema validation
8. **CLI Error Handling** - Limited error handling for malformed commands
9. **API Validation** - No validation of pipeline definition structure
10. **Pipeline Resumption** - No mechanism to resume interrupted pipelines
11. **Environment Management** - Only warns about missing API keys
12. **LLM Parallel Execution** - Doesn't handle partial failures well
13. **OpenAI Provider** - Responses API fallback confusion and token estimation
14. **UI State** - Global mutable state with no persistence

---

## Phase 1: Immediate Fixes (High Priority)

### 1.1 Input Validation for Seed Files

**Issue**: No validation on seed files submitted to the pipeline

**Impact**: High - Could cause pipeline failures or security issues

**Steps**:

1. Create JSON schema for seed file structure
2. Add validation function in `src/core/orchestrator.js`
3. Validate seed files before moving to current directory
4. Return clear error messages for invalid seeds
5. Add tests for validation logic

**Files to Modify**:

- `src/core/orchestrator.js` - Add validation before processing
- `src/api/index.js` - Add validation in submitJob function
- Create `src/core/validation.js` - Centralized validation utilities

**Implementation Details**:

```javascript
// src/core/validation.js
import Ajv from "ajv";

const seedSchema = {
  type: "object",
  required: ["name", "data"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    data: { type: "object" },
    metadata: { type: "object" },
  },
  additionalProperties: false,
};

export function validateSeed(seed) {
  const ajv = new Ajv();
  const validate = ajv.compile(seedSchema);
  const valid = validate(seed);

  if (!valid) {
    return {
      valid: false,
      errors: validate.errors,
    };
  }

  return { valid: true };
}
```

**Success Criteria**:

- All seed files validated before processing
- Clear error messages for validation failures
- Test coverage > 90% for validation logic
- No breaking changes to existing valid seeds

**Estimated Effort**: 1-2 days

---

### 1.2 Error Recovery in Orchestrator

**Issue**: Insufficient error recovery, no retry for failed process spawns

**Impact**: High - Pipeline jobs can be lost on transient failures

**Steps**:

1. Add retry logic for process spawn failures
2. Implement exponential backoff for retries
3. Add error state tracking in tasks-status.json
4. Log all errors with context
5. Add configurable retry limits
6. Implement dead letter queue for permanently failed jobs

**Files to Modify**:

- `src/core/orchestrator.js` - Add retry logic
- `src/core/pipeline-runner.js` - Better error handling
- Create `src/core/retry.js` - Reusable retry utilities

**Implementation Details**:

```javascript
// src/core/retry.js
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    onRetry = () => {},
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay
      );

      onRetry({ attempt, delay, error });
      await sleep(delay);
    }
  }

  throw lastError;
}
```

**Success Criteria**:

- Process spawn failures automatically retried
- Failed jobs moved to dead letter queue after max retries
- All errors logged with full context
- Test coverage for retry logic
- No data loss on transient failures

**Estimated Effort**: 2-3 days

---

### 1.3 UI Server Authentication

**Issue**: No authentication on UI server

**Impact**: High - Security vulnerability

**Steps**:

1. Add token-based authentication
2. Implement middleware for auth checking
3. Add environment variable for auth token
4. Update UI client to send auth token
5. Add rate limiting per token
6. Document authentication setup

**Files to Modify**:

- `src/ui/server.js` - Add auth middleware
- `src/ui/public/app.js` - Send auth token
- `src/core/environment.js` - Load auth config
- Create `src/ui/auth.js` - Authentication utilities

**Implementation Details**:

```javascript
// src/ui/auth.js
export function createAuthMiddleware(token) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const providedToken = authHeader.slice(7);

    if (providedToken !== token) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

    next();
  };
}
```

**Success Criteria**:

- All UI endpoints require authentication
- Token configurable via environment variable
- Clear error messages for auth failures
- Documentation for setup
- Backward compatible (auth optional if not configured)

**Estimated Effort**: 1-2 days

---

### 1.4 CLI Error Handling

**Issue**: Limited error handling for malformed commands

**Impact**: Medium - Poor user experience

**Steps**:

1. Add command validation
2. Implement helpful error messages
3. Add command suggestions for typos
4. Validate required arguments
5. Add --help for all commands
6. Handle SIGINT/SIGTERM gracefully

**Files to Modify**:

- `src/cli/index.js` - Enhanced error handling

**Implementation Details**:

```javascript
// Enhanced command parsing with validation
function parseCommand(args) {
  const validCommands = ["init", "start", "submit", "status", "stop"];
  const command = args[0];

  if (!command) {
    throw new Error("No command provided. Use --help for usage information.");
  }

  if (!validCommands.includes(command)) {
    const suggestions = validCommands
      .filter((cmd) => levenshteinDistance(cmd, command) <= 2)
      .map((cmd) => `  - ${cmd}`)
      .join("\n");

    throw new Error(
      `Unknown command: ${command}\n` +
        (suggestions ? `Did you mean:\n${suggestions}` : "") +
        "\nUse --help for usage information."
    );
  }

  return command;
}
```

**Success Criteria**:

- All invalid commands show helpful errors
- Typos suggest correct commands
- All commands have --help
- Graceful shutdown on signals
- Test coverage for error cases

**Estimated Effort**: 1 day

---

## Phase 2: Short Term Improvements

### 2.1 Configurable Values

**Issue**: Hard-coded timeouts, limits, and paths throughout codebase

**Impact**: Medium - Reduces flexibility and maintainability

**Steps**:

1. Create centralized configuration module
2. Define configuration schema
3. Support environment variables
4. Support config file (JSON/YAML)
5. Add validation for config values
6. Document all configuration options
7. Migrate hard-coded values to config

**Files to Create**:

- `src/core/config.js` - Configuration management
- `config.schema.json` - JSON schema for validation
- `config.example.json` - Example configuration

**Configuration Structure**:

```javascript
// Default configuration
export const defaultConfig = {
  orchestrator: {
    shutdownTimeout: 2000,
    processSpawnRetries: 3,
    lockFileTimeout: 5000,
    watchDebounce: 100,
  },
  taskRunner: {
    maxRefinementAttempts: 2,
    stageTimeout: 300000,
    llmRequestTimeout: 60000,
  },
  ui: {
    port: 3000,
    host: "localhost",
    heartbeatInterval: 30000,
    maxRecentChanges: 10,
  },
  paths: {
    root: process.env.PO_ROOT || process.cwd(),
    dataDir: "pipeline-data",
    configDir: "pipeline-config",
    pendingDir: "pending",
    currentDir: "current",
    completeDir: "complete",
  },
  logging: {
    level: "info",
    format: "json",
    destination: "stdout",
  },
};
```

**Success Criteria**:

- All hard-coded values moved to config
- Config validated on load
- Environment variables override config file
- Complete documentation
- Backward compatible defaults

**Estimated Effort**: 3-4 days

---

### 2.2 Pipeline Definition Schema Validation

**Issue**: No schema validation for pipeline definitions

**Impact**: Medium - Can cause runtime errors

**Steps**:

1. Create JSON schema for pipeline.json
2. Add validation on pipeline load
3. Validate task registry structure
4. Check task module exports
5. Add helpful error messages
6. Document pipeline schema

**Files to Modify**:

- `src/core/pipeline-runner.js` - Add validation
- Create `schemas/pipeline.schema.json`
- Create `schemas/task-registry.schema.json`

**Pipeline Schema**:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name", "version", "tasks"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "minLength": 1,
      "maxLength": 100
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "tasks": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "uniqueItems": true
    },
    "metadata": {
      "type": "object"
    }
  },
  "additionalProperties": false
}
```

**Success Criteria**:

- All pipeline definitions validated on load
- Clear error messages for invalid schemas
- Task module exports validated
- Documentation with examples
- Test coverage for validation

**Estimated Effort**: 2-3 days

---

### 2.3 Transaction Safety for File Operations

**Issue**: No transaction safety, mutable state, no pipeline resumption

**Impact**: Medium-High - Data loss on failures

**Steps**:

1. Implement write-ahead logging (WAL)
2. Add atomic file operations
3. Create transaction log for state changes
4. Implement pipeline resumption logic
5. Add checkpoint mechanism
6. Test crash recovery scenarios

**Files to Create**:

- `src/core/transactions.js` - Transaction utilities
- `src/core/checkpoint.js` - Checkpoint management
- `src/core/recovery.js` - Recovery logic

**Implementation Details**:

```javascript
// src/core/transactions.js
export class Transaction {
  constructor(logPath) {
    this.logPath = logPath;
    this.operations = [];
  }

  async writeFile(path, content) {
    this.operations.push({
      type: "write",
      path,
      content,
      backup: await this.backupFile(path),
    });
  }

  async deleteFile(path) {
    this.operations.push({
      type: "delete",
      path,
      backup: await this.backupFile(path),
    });
  }

  async commit() {
    // Write transaction log
    await this.writeLog();

    // Execute operations
    for (const op of this.operations) {
      await this.executeOperation(op);
    }

    // Clear log on success
    await this.clearLog();
  }

  async rollback() {
    // Restore from backups
    for (const op of this.operations.reverse()) {
      await this.restoreBackup(op);
    }
  }
}
```

**Success Criteria**:

- All file operations are atomic
- Pipeline can resume after crash
- Transaction log tracks all changes
- Rollback works correctly
- Test coverage for recovery scenarios

**Estimated Effort**: 4-5 days

---

### 2.4 Structured Logging

**Issue**: Limited logging, no structured format

**Impact**: Medium - Poor observability

**Steps**:

1. Implement structured logging library
2. Add log levels (debug, info, warn, error)
3. Include context in all logs (jobName, taskName, stage)
4. Add correlation IDs for request tracing
5. Support multiple outputs (console, file, remote)
6. Add log rotation
7. Document logging conventions

**Files to Create**:

- `src/core/logger.js` - Logging utilities
- `src/core/correlation.js` - Correlation ID management

**Implementation Details**:

```javascript
// src/core/logger.js
import winston from "winston";

export function createLogger(options = {}) {
  const { level = "info", format = "json", destination = "stdout" } = options;

  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      format === "json" ? winston.format.json() : winston.format.simple()
    ),
    defaultMeta: {
      service: "prompt-orchestration-pipeline",
    },
    transports: [
      destination === "stdout"
        ? new winston.transports.Console()
        : new winston.transports.File({ filename: destination }),
    ],
  });
}

export function withContext(logger, context) {
  return {
    debug: (msg, meta) => logger.debug(msg, { ...context, ...meta }),
    info: (msg, meta) => logger.info(msg, { ...context, ...meta }),
    warn: (msg, meta) => logger.warn(msg, { ...context, ...meta }),
    error: (msg, meta) => logger.error(msg, { ...context, ...meta }),
  };
}
```

**Success Criteria**:

- All components use structured logging
- Logs include full context
- Correlation IDs track requests
- Multiple output destinations supported
- Log rotation configured
- Documentation for log analysis

**Estimated Effort**: 2-3 days

---

### 2.5 Environment Validation Enforcement

**Issue**: Only warns about missing API keys, doesn't enforce

**Impact**: Medium - Runtime failures

**Steps**:

1. Make API key validation strict by default
2. Add --skip-validation flag for development
3. Validate provider configs on startup
4. Check for conflicting configurations
5. Add helpful error messages
6. Document required environment variables

**Files to Modify**:

- `src/core/environment.js` - Strict validation

**Implementation Details**:

```javascript
export function validateEnvironment(options = {}) {
  const { strict = true, requiredProviders = [] } = options;
  const errors = [];
  const warnings = [];

  // Check for at least one provider
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;

  if (!hasOpenAI && !hasAnthropic && !hasDeepSeek) {
    errors.push(
      "No LLM provider API keys found. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY"
    );
  }

  // Check required providers
  for (const provider of requiredProviders) {
    if (provider === "openai" && !hasOpenAI) {
      errors.push("OPENAI_API_KEY is required but not set");
    }
    // ... similar for other providers
  }

  if (strict && errors.length > 0) {
    throw new Error(
      "Environment validation failed:\n" +
        errors.map((e) => `  - ${e}`).join("\n")
    );
  }

  return { errors, warnings };
}
```

**Success Criteria**:

- Strict validation by default
- Clear error messages
- Development mode available
- All providers validated
- Documentation updated

**Estimated Effort**: 1 day

---

### 2.6 LLM Parallel Execution Error Handling

**Issue**: Parallel execution doesn't handle partial failures well

**Impact**: Medium - Can lose work on partial failures

**Steps**:

1. Add error collection for parallel operations
2. Implement partial success handling
3. Add retry for failed items only
4. Return detailed results with successes and failures
5. Add configurable failure threshold
6. Document parallel execution behavior

**Files to Modify**:

- `src/llm/index.js` - Enhance parallel function

**Implementation Details**:

```javascript
export async function parallel(fn, items, options = {}) {
  const {
    maxConcurrency = 5,
    retryFailures = true,
    maxRetries = 2,
    failureThreshold = 1.0, // 1.0 = allow all failures
  } = options;

  const results = [];
  const failures = [];

  // Process in batches
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);
    const promises = batch.map(async (item, idx) => {
      try {
        const result = await fn(item);
        return { success: true, item, result, index: i + idx };
      } catch (error) {
        return { success: false, item, error, index: i + idx };
      }
    });

    const batchResults = await Promise.all(promises);

    for (const result of batchResults) {
      if (result.success) {
        results.push(result);
      } else {
        failures.push(result);
      }
    }
  }

  // Retry failures if enabled
  if (retryFailures && failures.length > 0) {
    // ... retry logic
  }

  // Check failure threshold
  const failureRate = failures.length / items.length;
  if (failureRate > failureThreshold) {
    throw new Error(
      `Parallel execution exceeded failure threshold: ${failures.length}/${items.length} failed`
    );
  }

  return {
    successes: results,
    failures,
    total: items.length,
  };
}
```

**Success Criteria**:

- Partial failures handled gracefully
- Failed items can be retried
- Detailed results returned
- Configurable failure threshold
- Test coverage for failure scenarios

**Estimated Effort**: 2 days

---

### 2.7 OpenAI Provider Improvements

**Issue**: Responses API fallback confusion, token estimation issues

**Impact**: Medium - User confusion and inaccurate metrics

**Steps**:

1. Add clear logging for API selection
2. Improve token estimation for GPT-5
3. Document API differences
4. Add configuration for API preference
5. Standardize temperature defaults
6. Add tests for both APIs

**Files to Modify**:

- `src/providers/openai.js` - Improvements
- `src/llm/README.md` - Documentation

**Implementation Details**:

```javascript
export async function openaiChat(options) {
  const { model, messages, temperature, ...rest } = options;

  // Determine API to use
  const useResponsesAPI = model.startsWith("gpt-5");
  const apiName = useResponsesAPI ? "Responses API" : "Chat Completions API";

  logger.debug(`Using OpenAI ${apiName} for model ${model}`);

  // Standardize temperature (default 0.7 for both)
  const temp = temperature ?? 0.7;

  try {
    if (useResponsesAPI) {
      return await callResponsesAPI({
        model,
        messages,
        temperature: temp,
        ...rest,
      });
    } else {
      return await callChatCompletionsAPI({
        model,
        messages,
        temperature: temp,
        ...rest,
      });
    }
  } catch (error) {
    if (useResponsesAPI && isResponsesAPIError(error)) {
      logger.warn(`Responses API failed, falling back to Chat Completions API`);
      return await callChatCompletionsAPI({
        model,
        messages,
        temperature: temp,
        ...rest,
      });
    }
    throw error;
  }
}
```

**Success Criteria**:

- Clear logging for API selection
- Accurate token estimation
- Consistent temperature defaults
- Documented API differences
- Test coverage for both APIs

**Estimated Effort**: 2 days

---

### 2.8 UI State Persistence

**Issue**: Global mutable state with no persistence

**Impact**: Medium - State lost on restart

**Steps**:

1. Implement state persistence to disk
2. Add state recovery on startup
3. Make state immutable with updates
4. Add state versioning
5. Implement state snapshots
6. Add state cleanup for old data

**Files to Modify**:

- `src/ui/state.js` - Add persistence
- Create `src/ui/state-store.js` - Storage layer

**Implementation Details**:

```javascript
// src/ui/state-store.js
export class StateStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.state = null;
  }

  async load() {
    try {
      const data = await fs.readFile(this.storePath, "utf8");
      this.state = JSON.parse(data);
    } catch (error) {
      // Initialize with default state
      this.state = this.getDefaultState();
    }
    return this.state;
  }

  async save(state) {
    // Create immutable copy
    const newState = {
      ...state,
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    // Write atomically
    const tempPath = `${this.storePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(newState, null, 2));
    await fs.rename(tempPath, this.storePath);

    this.state = newState;
    return newState;
  }

  getDefaultState() {
    return {
      updatedAt: new Date().toISOString(),
      changeCount: 0,
      recentChanges: [],
      watchedPaths: [],
      version: 1,
    };
  }
}
```

**Success Criteria**:

- State persisted to disk
- State recovered on restart
- Immutable state updates
- Atomic writes
- Test coverage for persistence

**Estimated Effort**: 2 days

---

## Phase 3: Long Term Enhancements

### 3.1 Horizontal Scaling Design

**Issue**: Single orchestrator instance, no distributed execution

**Impact**: High - Scalability limitations

**Steps**:

1. Design distributed architecture
2. Implement message queue for job distribution
3. Add worker pool management
4. Implement distributed locking (Redis/etcd)
5. Add load balancing
6. Implement health checks
7. Add auto-scaling support
8. Document deployment patterns

**Architecture Changes**:

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                         │
└─────────────────────┬───────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼───┐   ┌───▼────┐  ┌───▼────┐
    │ API    │   │ API    │  │ API    │
    │ Node 1 │   │ Node 2 │  │ Node 3 │
    └────┬───┘   └───┬────┘  └───┬────┘
         │           │           │
         └───────────┼───────────┘
                     │
              ┌──────▼──────┐
              │ Message     │
              │ Queue       │
              │ (Redis/SQS) │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼───┐  ┌───▼────┐ ┌───▼────┐
    │Worker 1│  │Worker 2│ │Worker 3│
    └────┬───┘  └───┬────┘ └───┬────┘
         │          │          │
         └──────────┼──────────┘
                    │
             ┌──────▼──────┐
             │  Shared     │
             │  Storage    │
             │  (S3/NFS)   │
             └─────────────┘
```

**Components to Create**:

- `src/distributed/queue.js` - Message queue abstraction
- `src/distributed/worker.js` - Worker implementation
- `src/distributed/coordinator.js` - Coordination logic
- `src/distributed/locks.js` - Distributed locking

**Success Criteria**:

- Multiple workers can process jobs
- Jobs distributed via message queue
- Distributed locking prevents conflicts
- Health checks and auto-scaling
- Documentation for deployment
- Load testing validates scaling

**Estimated Effort**: 3-4 weeks

---

### 3.2 Distributed Tracing

**Issue**: No distributed tracing, limited observability

**Impact**: Medium - Difficult to debug distributed systems

**Steps**:

1. Integrate OpenTelemetry
2. Add trace context propagation
3. Instrument all components
4. Add span attributes for context
5. Configure trace exporters
6. Set up trace visualization (Jaeger/Zipkin)
7. Document tracing setup

**Files to Create**:

- `src/observability/tracing.js` - Tracing utilities
- `src/observability/instrumentation.js` - Auto-instrumentation

**Implementation Details**:

```javascript
// src/observability/tracing.js
import { trace, context } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";

export function initializeTracing(serviceName) {
  const provider = new NodeTracerProvider();

  provider.addSpanProcessor(
    new BatchSpanProcessor(
      new JaegerExporter({
        endpoint: process.env.JAEGER_ENDPOINT,
      })
    )
  );

  provider.register();

  return trace.getTracer(serviceName);
}

export function withSpan(tracer, name, fn) {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

**Success Criteria**:

- All components instrumented
- Traces show full request flow
- Trace context propagated across processes
- Visualization setup documented
- Performance overhead < 5%

**Estimated Effort**: 2-3 weeks

---

### 3.3 Pipeline Resumption

**Issue**: No mechanism to resume interrupted pipelines

**Impact**: High - Work lost on failures

**Steps**:

1. Implement checkpoint system
2. Save state after each task completion
3. Add resume command to CLI
4. Detect incomplete pipelines on startup
5. Implement idempotent task execution
6. Add task-level retry configuration
7. Test various failure scenarios

**Files to Create**:

- `src/core/checkpoint.js` - Checkpoint management
- `src/core/resume.js` - Resume logic

**Implementation Details**:

```javascript
// src/core/checkpoint.js
export class CheckpointManager {
  constructor(pipelinePath) {
    this.pipelinePath = pipelinePath;
    this.checkpointPath = path.join(pipelinePath, "checkpoint.json");
  }

  async save(state) {
    const checkpoint = {
      timestamp: new Date().toISOString(),
      completedTasks: state.completedTasks,
      currentTask: state.currentTask,
      context: state.context,
      version: 1,
    };

    await fs.writeFile(
      this.checkpointPath,
      JSON.stringify(checkpoint, null, 2)
    );
  }

  async load() {
    try {
      const data = await fs.readFile(this.checkpointPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  async canResume() {
    const checkpoint = await this.load();
    return checkpoint !== null;
  }
}
```

**Success Criteria**:

- Pipelines can resume after any failure
- No duplicate work on resume
- Checkpoint overhead < 100ms per task
- CLI command for manual resume
- Test coverage for resume scenarios

**Estimated Effort**: 2-3 weeks

---

### 3.4 Message Queue Integration

**Issue**: File-based job distribution doesn't scale

**Impact**: High - Scalability bottleneck

**Steps**:

1. Design message queue abstraction
2. Implement adapters for multiple queues (Redis, SQS, RabbitMQ)
3. Add job serialization/deserialization
4. Implement at-least-once delivery
5. Add dead letter queue
6. Implement priority queues
7. Add monitoring and metrics
8. Document queue setup

**Files to Create**:

- `src/queue/index.js` - Queue abstraction
- `src/queue/redis.js` - Redis adapter
- `src/queue/sqs.js` - AWS SQS adapter
- `src/queue/rabbitmq.js` - RabbitMQ adapter

**Queue Interface**:

```javascript
// src/queue/index.js
export class Queue {
  async enqueue(job, options = {}) {
    // Add job to queue
  }

  async dequeue(options = {}) {
    // Get next job from queue
  }

  async ack(jobId) {
    // Acknowledge job completion
  }

  async nack(jobId, options = {}) {
    // Negative acknowledge (retry or D
```
