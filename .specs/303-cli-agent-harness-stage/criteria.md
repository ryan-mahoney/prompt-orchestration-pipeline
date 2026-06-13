# Criteria: CLI Agent Harness Stage

- Spec source: `.specs/303-cli-agent-harness-stage/spec.md`
- Phase: N/A
- Baseline commit: `521c9232ee2bf93bc9e352c81c2ed26df0a2760d`
- Blindness: compiled blind; implementation files for `src/harness/*` and `src/core/agent-step.ts` did not exist at compile time. Only the reviewed spec, proposal, and pre-existing precedent code were used.
- Counts: G=6, D=1, S=5, X ledger entries added=8, T register=16

### C-1 (G) - shared harness contracts stay in `src/harness/types.ts`

Source: §4 Architecture - "`src/harness/types.ts` | Shared types: `HarnessName`, `HarnessRunOptions`, `HarnessRunResult`, `HarnessEvent`, `HarnessUsage`, `McpServerConnection`, `HarnessDescriptor`, `AgentEntryConfig`, `AgentStepResult`."
Check: `rg -n "export (type HarnessName|interface (McpServerConnection|HarnessUsage|HarnessEvent|HarnessRunOptions|HarnessRunResult|HarnessDescriptor|AgentEntryConfig|AgentStepResult))" src`
Expect: matches only in `src/harness/types.ts`.
Violation means: shared harness contracts were duplicated or moved out of the designated type owner.
Ledger: I-1.

### C-2 (D) - JSONL subprocess runner preserves the OpenCode CLI precedent

Source: §7 Implementation Steps - "exporting `runJsonlSubprocess({ argv, env, cwd?, timeoutMs, signal? }) -> Promise<{ events: unknown[]; stdout: string; stderr: string; exitCode: number; timedOut: boolean }>`", "lifted from `runOpenCodeCli`", and "skip unparseable".
Diff target: baseline `src/providers/opencode.ts` `runOpenCodeCli` block, approximately lines 315-386 at baseline.

Licensed deltas:

| Delta | Quote |
| --- | --- |
| New runner is exported from `src/harness/subprocess.ts`. | "Create `src/harness/subprocess.ts` exporting `runJsonlSubprocess`" |
| Runner accepts optional cwd and AbortSignal. | "`runJsonlSubprocess({ argv, env, cwd?, timeoutMs, signal? })`" |
| Runner returns raw stdout/stderr/exit metadata instead of OpenCode text. | "`Promise<{ events: unknown[]; stdout: string; stderr: string; exitCode: number; timedOut: boolean }>`" |
| Runner reports non-zero exit through `exitCode`/`stderr`; executor owns throwing. | "non-zero exit is reported via `exitCode`/`stderr`" |
| Runner omits OpenCode-specific text extraction and error messages. | "Refactor OpenCode CLI path ... keep the existing text/event extraction and error semantics" |

Any other divergence from the precedent subprocess mechanics is a violation.

### C-3 (G) - harness-specific argv/env logic stays descriptor-owned

Source: §4 Architecture - "Each implements `HarnessDescriptor` per §4 (argv with the unrestricted flag + model + cwd; env/tmpFiles for MCP...)".
Check: `rg -n "dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|OPENCODE_PERMISSION|OPENCODE_CONFIG_DIR|POP_MCP_TOKEN|--mcp-config|mcp_servers\\.popio|--skip-git-repo-check" src/core src/harness src/providers/opencode.ts`
Expect: production hits for new harness execution only in `src/harness/descriptors/claude.ts`, `src/harness/descriptors/codex.ts`, and `src/harness/descriptors/opencode.ts`. The pre-existing `src/providers/opencode.ts` chat provider may still contain its own `OPENCODE_PERMISSION`, but it must not contain new agent-harness MCP or unrestricted-argv wiring.
Violation means: executor, runner, or agent-step code learned per-harness CLI details instead of delegating them to descriptors.
Ledger: I-2.

### C-4 (G) - Codex auth/config store is not replaced

Source: §4 Per-harness argv/env - "Do not replace `CODEX_HOME`; the user config/auth store must remain available."
Check: `rg -n "CODEX_HOME" src/harness src/core`
Expect: no matches.
Violation means: the Codex descriptor or executor hides the user's Codex auth/config store.
Ledger: I-3.

### C-5 (S) - MCP tools delegate to `TaskFileIO`

Source: §4 MCP IO server - "Tools (all delegate to the passed `io`): `write_artifact(name, content)`, `read_artifact(name)`, `write_log(name, content)`, `write_tmp(name, content)`, `read_tmp(name)`."
Question: In `src/harness/mcp-io-server.ts`, does each MCP tool call the corresponding passed `TaskFileIO` method (`writeArtifact`, `readArtifact`, `writeLog`, `writeTmp`, `readTmp`) without writing directly to `files/artifacts`, `files/logs`, `files/tmp`, or `tasks-status.json`?
Files to read: `src/harness/mcp-io-server.ts`, `src/core/file-io.ts`.
Violation means: MCP artifact/status effects bypass POP's existing file tracking path.
Ledger: I-4.

### C-6 (S) - MCP transport stays in-process HTTP, not stdio or child-process based

Source: §6 Notes - "HTTP MCP, not stdio" and "The MCP server must share the step's in-process `TaskFileIO` closure."
Question: Does `src/harness/mcp-io-server.ts` use the SDK Streamable HTTP transport in-process, bind to localhost, and avoid stdio transports or spawned child MCP servers?
Files to read: `src/harness/mcp-io-server.ts`.
Violation means: the MCP server no longer shares the step's in-process `TaskFileIO` closure.
Ledger: I-5.

### C-7 (G) - agent event logs use POP log naming

Source: §4 Agent step - "streaming events as JSONL into `io.writeLog(generateLogName(entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT), ..., { mode: "append" })`."
Check: `rg -n "harness-events\\.jsonl|writeLog\\(\"|generateLogName\\([^\\n]*\"agent\"|LogEvent\\.DEBUG|LogFileExtension\\.TEXT" src/core/agent-step.ts`
Expect: no `harness-events.jsonl` match; no raw `writeLog("...")` filename; matches showing `generateLogName(entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT)`.
Violation means: agent logging bypasses the repository's validated log-name format.

### C-8 (G) - agent outputs go through `TaskFileIO`

Source: §3 Goal - "lets it write POP artifacts via a local MCP server" and §4 Agent step - "Write `io.writeArtifact("agent-result.md", finalMessage)`."
Check: `rg -n "Bun\\.write|writeFile|appendFile|files/(artifacts|logs|tmp)|tasks-status\\.json" src/core/agent-step.ts src/harness/mcp-io-server.ts`
Expect: no matches for direct artifact/log/tmp/status writes. Temp git-index file cleanup in `src/core/agent-step.ts` is allowed only when it does not target POP artifact/log/tmp/status paths.
Violation means: agent output bypasses `TaskFileIO` and may not be tracked in `tasks-status.json`.
Ledger: I-4.

### C-9 (S) - diff capture never mutates the real git index

Source: §4 Agent step - "capture `agent.patch` without mutating the real git index" and "GIT_INDEX_FILE=<tmp>".
Question: Does the `captureDiff:true` implementation in `src/core/agent-step.ts` perform all `read-tree`, `add -A`, and `diff --cached --binary` operations with a temporary `GIT_INDEX_FILE`, including the no-`HEAD` `read-tree --empty` path, and remove that temp index afterward?
Files to read: `src/core/agent-step.ts`.
Violation means: optional diff capture can stage or alter operator repository state.
Ledger: I-6.

### C-10 (S) - pipeline config validation stays in the validation layer

Source: §4 Pipeline wiring - "`pipeline-definition.ts` / `validation.ts`: ... Invalid config throws through `validatePipelineOrThrow()` like existing pipeline-definition errors."
Question: Do `src/core/pipeline-definition.ts` and `src/core/validation.ts` keep the same split as the spec: entry shape/types/normalization in `pipeline-definition.ts`, and agent config rejection logic in `validation.ts`, with no agent validation embedded in `src/core/pipeline-runner.ts`?
Files to read: `src/core/pipeline-definition.ts`, `src/core/validation.ts`, `src/core/pipeline-runner.ts`.
Violation means: pipeline validation moved into normalization or runtime execution instead of the existing validation surface.
Ledger: I-7.

### C-11 (S) - runner handles agent entries before task registry lookup

Source: §4 Pipeline wiring - "in the entry-processing loop, before task delegation, `if (selectedEntry.agent) { result = await runAgentStep(...); mark status; record usage; continue; }`."
Question: In `src/core/pipeline-runner.ts`, is the `selectedEntry.agent` branch executed before the task key is resolved and before `taskRegistry[taskKey]` is required?
Files to read: `src/core/pipeline-runner.ts`.
Violation means: valid agent entries can still fail as unregistered task entries.

### C-12 (G) - no new harness SDK dependency

Source: §6 Notes - "CLI-only, no SDKs" and "Only `@modelcontextprotocol/sdk` (server side) is added."
Check: `rg -n "\"@modelcontextprotocol/sdk\"|\"@openai/codex-sdk\"|\"@anthropic-ai|\"@claude" package.json`
Expect: one `@modelcontextprotocol/sdk` dependency and no Codex/Claude agent SDK dependencies. The pre-existing `@opencode-ai/sdk` dependency for the chat provider is outside this check.
Violation means: the implementation changed the harness execution model away from CLI-only.
Ledger: I-8.

## T Register

These tested statements are intentionally skipped as criteria:

- T-1 -> AC-1: agent entries parse and validate.
- T-2 -> AC-2: `runAgentStep` invokes the selected harness once with model and cwd.
- T-3 -> AC-3: descriptors include unrestricted controls, model, cwd, and MCP connection.
- T-4 -> AC-4: MCP `write_artifact` persists via `TaskFileIO` and appears in status/result artifacts.
- T-5 -> AC-5: MCP server binds to `127.0.0.1` and returns 401 without the bearer token.
- T-6 -> AC-6: `HarnessRunResult` exposes final message, session, usage, and cost when emitted.
- T-7 -> AC-7: harness events are written during the run.
- T-8 -> AC-8: `isHarnessAvailable()` uses a non-interactive version check.
- T-9 -> AC-9: non-zero exits include stderr and become `{ ok: false, error }` at the agent step.
- T-10 -> AC-10: timeouts kill and reject/abort instead of hanging.
- T-11 -> AC-11: invalid agent config cases fail deterministically.
- T-12 -> AC-12: the MCP server closes on success, failure, and timeout paths.
- T-13 -> AC-13: `captureDiff:true` writes/skips patches as specified and leaves the real index unchanged.
- T-14 -> AC-14: runner status transitions are pending -> running -> done.
- T-15 -> AC-15: token usage tuple is keyed `${harness}:${model ?? "default"}` with zero fallback values.
- T-16 -> AC-16: OpenCode chat provider behavior is unchanged after the subprocess extraction.
