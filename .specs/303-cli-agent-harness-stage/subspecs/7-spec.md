# Step 7: Agent Step Core

## Target Files

- **Create:** `src/core/agent-step.ts`
- **Create:** `src/core/__tests__/agent-step.test.ts`

## Source Symbols (as they exist now)

- `createTaskFileIO(config: TaskFileIOConfig): TaskFileIO` — `src/core/file-io.ts:200`
- `generateLogName(taskName, stage, event, ext): string` — `src/core/file-io.ts:82`
- `LogEvent.DEBUG` = `"debug"` — `src/config/log-events.ts:20`
- `LogFileExtension.TEXT` = `"log"` — `src/config/log-events.ts:32`
- `runHarnessTask(options, deps?): Promise<HarnessRunResult>` — `src/harness/executor.ts:12`
- `startMcpIoServer(io, opts?): Promise<McpIoServerHandle>` — `src/harness/mcp-io-server.ts:15`
- `AgentEntryConfig`, `AgentStepResult`, `HarnessRunResult` — `src/harness/types.ts`
- `TaskFileIO` — `src/core/file-io.ts:30`

## Concrete Edit Sequence

### 1. Create `src/core/agent-step.ts`

```ts
import { createTaskFileIO, generateLogName } from "./file-io.ts";
import { LogEvent, LogFileExtension } from "../config/log-events.ts";
import { runHarnessTask } from "../harness/executor.ts";
import { startMcpIoServer } from "../harness/mcp-io-server.ts";
import type { AgentEntryConfig, AgentStepResult } from "../harness/types.ts";
```

Function `runAgentStep(args, deps?)`:
1. Resolve injected deps: `_runHarnessTask = deps?.runHarnessTask ?? runHarnessTask`, `_startMcpIoServer = deps?.startMcpIoServer ?? startMcpIoServer`.
2. Build `io = createTaskFileIO({ workDir: args.workDir, taskName: args.entry.name, getStage: args.getStage, statusPath: args.statusPath })`.
3. Resolve `cwd = args.entry.cwd ?? io.getTaskDir()`.
4. Resolve prompt: `if (args.entry.prompt) prompt = args.entry.prompt; else prompt = await io.readArtifact(args.entry.promptFrom)`.
5. Guard: if neither prompt nor promptFrom is set, throw an error.
6. Start MCP server if `args.entry.io !== false`: `mcpHandle = await _startMcpIoServer(io)`.
7. In `try`: call `_runHarnessTask({ harness: args.entry.harness, prompt, cwd, model: args.entry.model, mcp: mcpHandle?.connection, timeoutMs: args.entry.timeoutMs, onEvent })` where `onEvent` appends `JSON.stringify(event.raw) + "\n"` to the log via `io.writeLog(generateLogName(args.entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT), ..., { mode: "append" })`.
8. Write `io.writeArtifact("agent-result.md", result.finalMessage)`.
9. Build return value: merge `mcpHandle?.artifactsWritten() ?? []` with `["agent-result.md"]` (deduplicated).
10. In `finally`: if `mcpHandle`, `await mcpHandle.close()`.
11. Return `AgentStepResult` with `ok: true`, `finalMessage`, `artifactsWritten`, `usage`, `costUsd`, `sessionId`.
12. Catch: return `AgentStepResult` with `ok: false`, `error: err.message`, `finalMessage: ""`, `artifactsWritten`, etc.

### 2. Create `src/core/__tests__/agent-step.test.ts`

Use vitest (`describe`, `it`, `expect`, `vi`). Inject fakes for `runHarnessTask` and `startMcpIoServer`.

**Test cases:**

1. **Success writes event log + agent-result.md and returns ok:true with usage/cost**
   - Inject `runHarnessTask` that returns a successful `HarnessRunResult` with usage/cost.
   - Inject `startMcpIoServer` that returns a fake handle.
   - Call `runAgentStep` with `entry.prompt`.
   - Assert: result.ok === true, result.finalMessage matches, result.usage/costUsd match, result.artifactsWritten includes "agent-result.md".
   - Assert: the `onEvent` callback was wired (events logged).

2. **promptFrom reads the named artifact for the prompt**
   - Inject a `runHarnessTask` that captures the prompt it receives.
   - Call `runAgentStep` with `entry.promptFrom: "my-prompt.md"`.
   - Assert: the captured prompt equals the content returned by `io.readArtifact`.

3. **Executor error yields ok:false with error and still calls mcpHandle.close()**
   - Inject `runHarnessTask` that throws `new Error("boom")`.
   - Inject `startMcpIoServer` with a spy on `close()`.
   - Assert: result.ok === false, result.error === "boom".
   - Assert: `mcpHandle.close()` was called.

4. **MCP server closed on success, failure, and timeout paths**
   - Three sub-tests or parameterized: success path, error path (executor throws), timeout path (executor throws timeout error).
   - Each asserts `mcpHandle.close()` was called.

## Stop Conditions

- Do NOT implement `captureDiff` (step 8).
- Do NOT wire into `pipeline-runner.ts` (step 10).
- Do NOT add validation (step 9).
- Do NOT modify any existing file.
