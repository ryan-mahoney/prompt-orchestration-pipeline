# Step 10: Wire the runner

## Target files

- `src/core/pipeline-runner.ts` — add agent branch in entry loop, add import
- `src/core/__tests__/pipeline-runner.test.ts` — add agent entry test cases

## Concrete edit sequence

### 1. Add import for `runAgentStep` in pipeline-runner.ts

Added after existing imports (line 15):
```ts
import { runAgentStep } from "./agent-step";
```

### 2. Add `agentFailed` flag before the while loop

Added before the `while (true)` loop:
```ts
let agentFailed = false;
```

### 3. Add agent branch in the entry loop

After the RUNNING status write (line 799) and before the task execution comment (line 801), inserted the agent branch. Key design decisions:
- Uses `process.exitCode = 1` + `break` instead of `process.exit(1)` to avoid the outer catch overwriting the failure status
- Sets `agentFailed = true` to skip the post-loop completion logic that would overwrite state to "done"
- Records token usage tuple as `[`${harness}:${model ?? "default"}`, inputTokens ?? 0, outputTokens ?? 0, costUsd ?? 0]`
- `taskEntry.error` is set as a plain string (matching the `TaskEntry` interface), not `NormalizedError`

### 4. Modify post-loop completion check

Changed from `if (!runSingleTask)` to `if (!runSingleTask && !agentFailed)` to prevent overwriting agent failure status with "done".

### 5. Add tests in pipeline-runner.test.ts

Added `mock.module("../agent-step", ...)` with `mockRunAgentStep` before the `runPipelineJob` import. Added `describe("runPipelineJob — agent entry wiring", ...)` with:
- `setupAgentFixture(agentConfig)` helper that creates pipeline.json with an agent entry object
- 4 test cases covering success, failure, usage with values, and usage with absent values

## Assumptions / notes

- Agent entries bypass the task registry entirely (the registry lookup happens after the agent branch)
- The `taskEntry.error` field in `TaskEntry` is `string | undefined`, not `NormalizedError`
- `process.exitCode = 1` + `break` is preferred over `process.exit(1)` in the agent branch to ensure the status write completes before the process exits
- The `agentFailed` flag prevents the pipeline completion logic from overwriting the failure status
