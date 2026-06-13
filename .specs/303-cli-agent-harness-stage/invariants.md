# Invariants: CLI Agent Harness Stage

## I-1 - Harness contracts stay centralized

- Establishing phase: N/A
- Invariant: Shared harness contracts stay owned by `src/harness/types.ts`; later phases must not duplicate these interfaces in descriptors, executor, runner, or agent-step modules.
- Source quote: "`src/harness/types.ts` | Shared types: `HarnessName`, `HarnessRunOptions`, `HarnessRunResult`, `HarnessEvent`, `HarnessUsage`, `McpServerConnection`, `HarnessDescriptor`, `AgentEntryConfig`, `AgentStepResult`."
- Suggested check: `rg -n "export (type HarnessName|interface (McpServerConnection|HarnessUsage|HarnessEvent|HarnessRunOptions|HarnessRunResult|HarnessDescriptor|AgentEntryConfig|AgentStepResult))" src` should match only `src/harness/types.ts`.

## I-2 - Harness-specific CLI details stay descriptor-owned

- Establishing phase: N/A
- Invariant: Per-harness argv/env/config details stay in `src/harness/descriptors/*`; `runHarnessTask`, `runAgentStep`, and `pipeline-runner` remain harness-agnostic.
- Source quote: "Each implements `HarnessDescriptor` per §4 (argv with the unrestricted flag + model + cwd; env/tmpFiles for MCP...)."
- Suggested check: `rg -n "dangerously-skip-permissions|dangerously-bypass-approvals-and-sandbox|OPENCODE_PERMISSION|OPENCODE_CONFIG_DIR|POP_MCP_TOKEN|--mcp-config|mcp_servers\\.popio|--skip-git-repo-check" src/core src/harness src/providers/opencode.ts` should place new agent-harness wiring only in descriptor modules.

## I-3 - Codex auth/config store remains available

- Establishing phase: N/A
- Invariant: The Codex harness must not replace `CODEX_HOME`; temporary MCP configuration must not hide the user's Codex auth/config store.
- Source quote: "Do not replace `CODEX_HOME`; the user config/auth store must remain available."
- Suggested check: `rg -n "CODEX_HOME" src/harness src/core` should return no matches.

## I-4 - Agent file effects stay `TaskFileIO`-owned

- Establishing phase: N/A
- Invariant: Agent artifacts, logs, tmp files, and their status tracking go through the passed `TaskFileIO`; MCP tools and agent-step orchestration must not write directly into POP artifact/log/tmp/status paths.
- Source quote: "Tools (all delegate to the passed `io`)" and "lets it write POP artifacts via a local MCP server".
- Suggested check: Read `src/harness/mcp-io-server.ts` and `src/core/agent-step.ts`; all POP file effects should call `io.writeArtifact`, `io.writeLog`, `io.writeTmp`, `io.readArtifact`, `io.readLog`, or `io.readTmp`.

## I-5 - MCP transport remains in-process HTTP

- Establishing phase: N/A
- Invariant: The POP IO MCP server stays in-process over localhost Streamable HTTP with bearer auth; it must not become a stdio child process.
- Source quote: "HTTP MCP, not stdio" and "The MCP server must share the step's in-process `TaskFileIO` closure."
- Suggested check: Read `src/harness/mcp-io-server.ts`; it should use Streamable HTTP transport, bind locally, enforce bearer auth, and contain no stdio transport or subprocess spawning.

## I-6 - Diff capture never stages operator changes

- Establishing phase: N/A
- Invariant: Agent diff capture must use a temporary git index for `read-tree`, `add -A`, and `diff --cached --binary`; it must not mutate the real git index.
- Source quote: "capture `agent.patch` without mutating the real git index".
- Suggested check: Read `src/core/agent-step.ts`; every diff-capture git command that stages or diffs staged content should run with `GIT_INDEX_FILE=<tmp>`.

## I-7 - Pipeline validation stays in `validation.ts`

- Establishing phase: N/A
- Invariant: Pipeline entry validation, including the `agent` entry kind, stays in `src/core/validation.ts`; `pipeline-definition.ts` owns shapes/normalization and `pipeline-runner.ts` assumes validated input.
- Source quote: "Invalid config throws through `validatePipelineOrThrow()` like existing pipeline-definition errors."
- Suggested check: Read `src/core/pipeline-definition.ts`, `src/core/validation.ts`, and `src/core/pipeline-runner.ts`; agent config rejection logic should be in `validation.ts`.

## I-8 - Harness execution remains CLI-only

- Establishing phase: N/A
- Invariant: The agent harness execution path uses CLIs for Claude, Codex, and OpenCode; this feature adds only the server-side MCP SDK dependency and no new harness SDK dependency.
- Source quote: "CLI-only, no SDKs" and "Only `@modelcontextprotocol/sdk` (server side) is added."
- Suggested check: `rg -n "\"@modelcontextprotocol/sdk\"|\"@openai/codex-sdk\"|\"@anthropic-ai|\"@claude" package.json` should show `@modelcontextprotocol/sdk` and no Codex/Claude agent SDK packages.

## I-9 - Binary resolution stays harness-agnostic; auth never blocks

- Establishing phase: N/A
- Invariant: The resolution mechanism (PATH healing, `Bun.which`, override env var, discovery, preflight) lives in `src/harness/resolve.ts` and `runHarnessTask`/`isHarnessAvailable`/`orchestrator`; per-harness binary name, install dirs, and auth-status command/interpreter stay descriptor-owned (extends I-2). The startup preflight must warn and continue — auth status (`true`/`false`/`null`) and a missing binary never block orchestrator startup.
- Source quote: "Launch-agnostic by design" and "Auth is checked via each CLI's own status command … and is advisory only."
- Suggested check: `rg -n "~/.opencode/bin|authStatusArgv|interpretAuthStatus|login.*status|auth.*status" src/harness` should place per-harness specifics only in `descriptors/*`; `rg -n "throw" src/core/orchestrator.ts` should show no preflight path that aborts startup on a missing/unauthenticated harness.
