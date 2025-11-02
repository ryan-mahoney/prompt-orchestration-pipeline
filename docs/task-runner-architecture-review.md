# Task Runner Architecture Review

**Source for observations:** [`src/core/task-runner.js`](src/core/task-runner.js) and demo task implementations under [`demo/pipeline-config/content-generation/tasks`](demo/pipeline-config/content-generation/tasks/analysis.js:1)

---

## 1. Modern Pipeline Architecture

### 1.1 Current Implementation

The task runner uses a modern, unified pipeline execution model with a single canonical stage order. All stages are optional and skipped if their handlers are not implemented. The pipeline maintains structured context with proper validation and type safety.

### 1.2 Canonical Stage Order

The pipeline executes stages in this fixed sequence:

1. ingestion
2. preProcessing
3. promptTemplating
4. inference
5. parsing
6. validateStructure
7. validateQuality
8. critique
9. refine
10. finalValidation
11. integration

### 1.3 Stage Handler Contract

All stage handlers must return an object conforming to the `{ output, flags }` contract:

- `output`: The stage's primary output data
- `flags`: Control flags that influence pipeline behavior

This contract is enforced by `assertStageResult()` and flag types are validated against schemas defined in `FLAG_SCHEMAS`.

---

## 2. Context Structure and Flow

### 2.1 Context Organization

The modern context structure is organized into logical sections:

- `meta`: Task metadata (taskName, workDir, statusPath, etc.)
- `data`: Stage outputs, including `data.seed` for initial input
- `flags`: Control flags for pipeline flow and validation state
- `logs`: Execution logs and audit trail
- `io`: File I/O operations singleton
- `llm`: LLM client instance

### 2.2 Stage Execution Context

Each stage receives a cloned context with:

- `output`: Output from the last executed stage (or seed for first stage)
- `previousStage`: Name of the last executed stage
- `currentStage`: Current stage being executed
- Isolated `data` and `flags` to prevent cross-contamination

### 2.3 Chaining Behavior

Stages are chained via the last successful stage output:

- Non-validation stages update `lastStageOutput` and `lastExecutedStageName`
- Validation stages are excluded from chaining to maintain clean data flow
- Missing handlers are skipped without breaking the pipeline

---

## 3. Refinement and Validation

### 3.1 Refinement Cycle Mechanics

- Validation stages (`validateStructure`, `validateQuality`) can trigger refinement
- During refinement, `ingestion` and `preProcessing` are automatically skipped
- Pre-refinement logic runs `critique` and `refine` before validation when needed
- Refinement cycles are bounded by `maxRefinements` configuration

### 3.2 Validation System

- Flag schemas define required and produced flags per stage
- Type validation ensures flag consistency across stages
- Validation failures trigger refinement when attempts remain
- Final validation failure occurs only if validation handlers exist

---

## 4. Error Handling and Observability

### 4.1 Error Management

- Stage failures are normalized and logged with context
- Validation errors trigger refinement instead of immediate failure
- Non-validation stage failures abort the pipeline immediately
- All errors include stage name, timing, and normalized error information

### 4.2 Logging and Metrics

- Comprehensive logging captures stage execution, timing, and reasons for skips
- LLM metrics are collected with task and stage annotations
- Status files provide real-time pipeline state updates
- Console output is captured per stage for debugging

---

## 5. Architectural Strengths

1. **Type Safety**: Structured `{ output, flags }` contracts with validation
2. **Flexibility**: Optional stages with clean skip behavior
3. **Observability**: Comprehensive logging and metrics collection
4. **Robustness**: Proper error handling and refinement cycles
5. **Isolation**: Cloned contexts prevent unintended mutations
6. **Extensibility**: Clear flag schema system for new stages

---

## 6. Design Decisions and Rationale

### 6.1 Single Pipeline Loop

The unified pipeline loop eliminates complexity while maintaining:

- Deterministic stage execution order
- Clean skip behavior for missing handlers
- Consistent error handling and logging
- Proper resource management and cleanup

### 6.2 Flag-Based Control Flow

Using structured flags instead of ad-hoc context mutations provides:

- Type safety and validation
- Clear documentation of stage dependencies
- Predictable behavior across different task implementations
- Easier testing and debugging

### 6.3 Optional Stage Design

Making all stages optional supports:

- Gradual adoption of new pipeline features
- Task-specific pipeline customization
- Backward compatibility with existing tasks
- Simplified testing scenarios

---

## 7. Conclusion

The modern task runner architecture provides a robust, type-safe, and flexible foundation for pipeline execution. The unified approach eliminates complexity while maintaining powerful features like refinement cycles, comprehensive validation, and detailed observability. The design supports both simple and complex use cases through its optional stage model and extensible flag system.
