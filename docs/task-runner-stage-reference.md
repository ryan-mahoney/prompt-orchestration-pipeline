# Task Runner Stage Reference

## Overview

This document provides comprehensive reference information for the 11-stage task execution pipeline and real-time stage tracking system. The task runner executes each task through a predefined sequence of stages, with atomic status updates that enable real-time UI monitoring.

**⚠️ Important**: This stage tracking system is **non-backward-compatible**. The `tasks-status.json` file is the single source of truth for current stage information and does not support legacy formats.

## 11-Stage Pipeline Architecture

Each task in the pipeline executes through the following stages in order:

| Stage ID            | Stage Name | Required                                                    | Description                                                                                                     | Error Behavior |
| ------------------- | ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| `validation`        | Required   | Validates task configuration and input data                 | Errors stop task immediately                                                                                    |
| `file-setup`        | Required   | Sets up file system and prepares working directories        | Errors stop task immediately                                                                                    |
| `preprocessing`     | Optional   | Preprocesses input data and prepares context                | Errors stop task immediately                                                                                    |
| `prompt-templating` | Required   | Generates prompts from templates and context data           | Errors stop task immediately                                                                                    |
| `inference`         | Optional   | Calls LLM with prompts from `context.data.promptTemplating` | Must have `promptTemplating` in data. `flags.validationFailed` triggers retry/critique loops; errors stop task. |
| `postprocessing`    | Required   | Processes LLM output and formats results                    | Errors stop task immediately                                                                                    |
| `validation-2`      | Optional   | Secondary validation of processed results                   | Errors stop task immediately                                                                                    |
| `file-cleanup`      | Required   | Cleans up temporary files and organizes output              | Errors stop task immediately                                                                                    |
| `serialization`     | Required   | Serializes final results for storage                        | Errors stop task immediately                                                                                    |
| `status-update`     | Required   | Updates task and pipeline status                            | Errors stop task immediately                                                                                    |
| `completion`        | Required   | Finalizes task execution and triggers next task             | Errors stop task immediately                                                                                    |

## Real-Time Stage Tracking

### Status Document Structure

The `tasks-status.json` file provides atomic, synchronous updates at stage boundaries:

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
    /* file tracking */
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
        /* per-task file tracking */
      },
      "artifacts": ["output.json", "letter.json", "execution-logs.json"],
      "executionTime": 12345.67,
      "refinementAttempts": 0
    }
  }
}
```

### Stage Lifecycle States

#### While Task is Running in Stage

```json
{
  "current": "research",
  "currentStage": "inference",
  "state": "running",
  "tasks": {
    "research": {
      "state": "running",
      "currentStage": "inference",
      "failedStage": null
    }
  },
  "lastUpdated": "2025-10-02T06:37:45.123Z"
}
```

#### On Successful Stage Completion

```json
{
  "current": "research",
  "currentStage": "postprocessing",
  "state": "running",
  "tasks": {
    "research": {
      "state": "running",
      "currentStage": "postprocessing",
      "failedStage": null
    }
  },
  "lastUpdated": "2025-10-02T06:37:50.456Z"
}
```

#### On Task Success

```json
{
  "current": "analysis",
  "currentStage": "validation",
  "state": "running",
  "tasks": {
    "research": {
      "state": "done",
      "currentStage": null,
      "failedStage": null,
      "endedAt": "2025-10-02T06:37:55.789Z"
    },
    "analysis": {
      "state": "running",
      "currentStage": "validation",
      "failedStage": null
    }
  },
  "lastUpdated": "2025-10-02T06:37:55.789Z"
}
```

#### On Task Failure at Stage

```json
{
  "current": "research",
  "currentStage": "inference",
  "state": "failed",
  "tasks": {
    "research": {
      "state": "failed",
      "currentStage": "inference",
      "failedStage": "inference"
    }
  },
  "lastUpdated": "2025-10-02T06:37:52.345Z"
}
```

## Atomic Status Updates

### Write Process

All status updates are performed atomically to prevent race conditions:

1. **Read Current State**: Load existing `tasks-status.json`
2. **Apply Update**: Modify fields via `updateFn(snapshot)`
3. **Atomic Write**: Write to temporary file, then rename to `tasks-status.json`
4. **SSE Event**: Emit `state:change` event immediately
5. **Return Updated State**: Provide new snapshot to caller

```javascript
// Example atomic update
const updatedStatus = await writeJobStatus(jobDir, (snapshot) => {
  snapshot.current = taskId;
  snapshot.currentStage = stageId;
  snapshot.tasks[taskId].currentStage = stageId;
  snapshot.tasks[taskId].state = "running";
  snapshot.lastUpdated = new Date().toISOString();
  return snapshot;
});
```

### SSE Event Emission

Every atomic write triggers an Server-Sent Event:

```javascript
{
  type: "state:change",
  payload: {
    path: "/pipeline-data/current/{jobId}/tasks-status.json"
  }
}
```

UI components listen for these events to update in real-time without polling.

## Stage-Specific Contracts

### validation Stage

- **Purpose**: Validate task configuration and input data
- **Input**: Task configuration from pipeline definition
- **Output**: Validated context or error
- **Error Handling**: Immediate task failure on validation errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "validation"`

### file-setup Stage

- **Purpose**: Initialize file system structure and working directories
- **Input**: Job directory path and task configuration
- **Output**: Prepared file structure and context
- **Error Handling**: Immediate task failure on filesystem errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "file-setup"`

### preprocessing Stage (Optional)

- **Purpose**: Transform and prepare input data for processing
- **Input**: Raw input data from seed file
- **Output**: Processed data in `context.data`
- **Error Handling**: Immediate task failure on preprocessing errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "preprocessing"`

### prompt-templating Stage

- **Purpose**: Generate prompts from templates using context data
- **Input**: Template files and context data
- **Output**: Formatted prompts in `context.data.promptTemplating`
- **Error Handling**: Immediate task failure on templating errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "prompt-templating"`

### inference Stage (Optional)

- **Purpose**: Execute LLM inference with generated prompts
- **Input**: Prompts from `context.data.promptTemplating`
- **Output**: LLM response in `context.data.inference`
- **Error Handling**:
  - `flags.validationFailed`: Triggers retry/critique loops
  - Other errors: Immediate task failure
- **Status Impact**: Sets `tasks[taskId].currentStage = "inference"`

### postprocessing Stage

- **Purpose**: Process and format LLM outputs for final use
- **Input**: Raw LLM responses from inference stage
- **Output**: Formatted results in `context.data`
- **Error Handling**: Immediate task failure on postprocessing errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "postprocessing"`

### validation-2 Stage (Optional)

- **Purpose**: Secondary validation of processed results
- **Input**: Processed results from postprocessing
- **Output**: Validation confirmation or error
- **Error Handling**: Immediate task failure on validation errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "validation-2"`

### file-cleanup Stage

- **Purpose**: Clean up temporary files and organize final outputs
- **Input**: Working directory and temporary files
- **Output**: Clean file structure with organized artifacts
- **Error Handling**: Immediate task failure on cleanup errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "file-cleanup"`

### serialization Stage

- **Purpose**: Serialize final results for storage and transmission
- **Input**: Processed and formatted results
- **Output**: Serialized artifacts in files system
- **Error Handling**: Immediate task failure on serialization errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "serialization"`

### status-update Stage

- **Purpose**: Update task status and prepare for completion
- **Input**: Current execution state and results
- **Output**: Updated status document
- **Error Handling**: Immediate task failure on status update errors
- **Status Impact**: Sets `tasks[taskId].currentStage = "status-update"`

### completion Stage

- **Purpose**: Finalize task execution and trigger next task or pipeline completion
- **Input**: Task execution results and status
- **Output**: Finalized task state and next task trigger
- **Error Handling**: Immediate task failure on completion errors
- **Status Impact**:
  - Success: `tasks[taskId].state = "done"`, advance to next task
  - Failure: `tasks[taskId].state = "failed"`, `root.state = "failed"`

## Error Handling and Recovery

### Stage-Level Errors

When a stage fails:

1. **Immediate Status Update**:

   ```json
   {
     "state": "failed",
     "current": "taskId",
     "currentStage": "failedStageId",
     "tasks": {
       "taskId": {
         "state": "failed",
         "currentStage": "failedStageId",
         "failedStage": "failedStageId"
       }
     }
   }
   ```

2. **SSE Event**: Emit `state:change` with failure status
3. **Pipeline Halt**: Stop further task execution
4. **UI Update**: Show failure state with failed stage information

### Recovery Mechanisms

- **Retry Logic**: Configurable retry attempts per stage
- **Critique Loops**: For inference validation failures
- **Manual Recovery**: UI can trigger retry of failed tasks
- **Rollback**: Failed tasks leave partial state for debugging

## UI Integration

### Stage Computation

UI components use the `computeTaskStage(job, taskId)` utility with preference order:

1. `tasks[taskId].currentStage` (per-task stage - highest priority)
2. `job.currentStage` (root stage - fallback when task matches current)
3. `tasks[taskId].failedStage` (for failed tasks)
4. `error.debug.stage` (legacy error information - lowest priority)

### Real-Time Updates

UI components receive updates through SSE events:

```javascript
// SSE event handling
eventSource.addEventListener("state:change", (event) => {
  const { path } = JSON.parse(event.data);
  if (path.endsWith("/tasks-status.json")) {
    // Refetch job status and update UI
    refetchJobStatus();
  }
});
```

## Non-Backward-Compatibility

### Breaking Changes

- **No Legacy Format Support**: Old status document shapes are not supported
- **Required Fields**: `currentStage`, `tasks[taskId].currentStage`, `lastUpdated` are required
- **Stage Dependency**: UI no longer infers stage from execution-logs.json
- **Atomic Updates**: All status changes must go through atomic write mechanism

### Migration Requirements

- **Existing Jobs**: Must be restarted to use new status format
- **UI Components**: Must use `computeTaskStage` utility for stage detection
- **Status Writers**: Must use `writeJobStatus` for all status updates
- **Error Handling**: Must update both root and per-task status fields

## Performance Considerations

### Atomic Write Overhead

- **File I/O**: Each stage update involves file read + temp write + rename
- **SSE Broadcasting**: Each write triggers network event
- **Lock Contention**: Minimal due to single-writer per job

### Optimization Strategies

- **Batch Updates**: Multiple field changes in single atomic operation
- **Event Debouncing**: UI can debounce rapid successive SSE events
- **Status Caching**: UI can cache status between SSE events
- **Selective Updates**: Only update fields that actually changed

## Security Considerations

### Status Document Access

- **Read Access**: UI components need read access to `tasks-status.json`
- **Write Access**: Only task runner should write status updates
- **SSE Events**: Authenticated clients receive appropriate job events
- **File Permissions**: Proper filesystem permissions on status files

### Data Sensitivity

- **Task Names**: May contain sensitive information about business processes
- **Stage Information**: May reveal internal system details
- **Error Messages**: Should not expose sensitive system internals
- **File Paths**: Should not reveal absolute filesystem structure

## Testing and Debugging

### Unit Testing

- **Stage Handlers**: Test each stage independently
- **Status Updates**: Test atomic write mechanism
- **Error Scenarios**: Test failure handling at each stage
- **UI Integration**: Test stage computation and SSE handling

### Integration Testing

- **End-to-End Pipelines**: Test complete pipeline execution
- **Failure Recovery**: Test error handling and recovery mechanisms
- **Real-Time Updates**: Test SSE event propagation
- **Concurrent Access**: Test multiple jobs running simultaneously

### Debugging Tools

- **Status Inspection**: Direct inspection of `tasks-status.json`
- **SSE Monitoring**: Monitor real-time status change events
- **Stage Logging**: Detailed logging for each stage execution
- **Error Tracing**: Complete error context in status document

## Best Practices

### Stage Implementation

- **Idempotent Operations**: Stages should be safe to retry
- **Minimal Side Effects**: Limit external system interactions
- **Clear Error Messages**: Provide actionable error information
- **Consistent Data Structures**: Use standard context data formats

### Status Management

- **Atomic Updates**: Always use `writeJobStatus` for status changes
- **Complete State**: Update all relevant fields in single operation
- **Immediate SSE**: Emit events immediately after successful writes
- **Error Consistency**: Ensure root and per-task status agree on failures

### UI Integration

- **Stage Preference**: Use `computeTaskStage` utility for stage detection
- **Event Handling**: Properly handle SSE events with debouncing
- **Error Display**: Show failed stage information clearly
- **Loading States**: Show appropriate loading states during stage transitions

This reference provides the complete specification for task runner stage execution and real-time status tracking. Implementations should follow these contracts precisely to ensure reliable operation and real-time UI updates.
