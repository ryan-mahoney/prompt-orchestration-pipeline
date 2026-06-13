# Spec: CLI Agent Harness Stage

## 1. Qualifications

- Bun subprocess APIs (`Bun.spawn`, stdio piping, kill, exit codes).
- Newline-delimited JSON (JSONL) event-stream parsing.
- Model Context Protocol (MCP) server implementation over Streamable HTTP (`@modelcontextprotocol/sdk`).
- POP pipeline internals: entry kinds, `TaskFileIO`, `tasks-status.json` status writing, the pipeline-runner entry loop.
- TypeScript module/interface design; Bun unit testing with boundary mocking.

## 2. Problem Statement

POP can use an agentic CLI harness only as a muzzled chat backend: the OpenCode provider (#302) runs deny-by-default with tools off and returns only the final message ([src/providers/opencode.ts:96-98](../../src/providers/opencode.ts)). There is no way to let a harness do real work — search files, run tools, run skills, modify code — and capture the result through POP's artifact/status system. This spec adds an `agent` pipeline entry kind that runs `claude`, `codex`, or `opencode` at a chosen model, fully unrestricted, in a working directory, connected to a local MCP server that writes artifacts through the same `TaskFileIO` path stages use.

## 3. Goal

A `pipeline.json` entry can declare `{ "name": "...", "agent": { "harness", "model", "prompt"|"promptFrom", ... } }`; the runner executes that harness fully unrestricted, lets it write POP artifacts via a local MCP server, captures the final message / usage / cost / event log / optional git diff, and records the step in `tasks-status.json` like any other entry.

## 4. Architecture

### Files to create

| File | Responsibility |
|---|---|
| `src/harness/types.ts` | Shared types: `HarnessName`, `HarnessRunOptions`, `HarnessRunResult`, `HarnessEvent`, `HarnessUsage`, `McpServerConnection`, `HarnessDescriptor`, `AgentEntryConfig`, `AgentStepResult`. |
| `src/harness/subprocess.ts` | `runJsonlSubprocess()` — bounded JSONL subprocess runner extracted from `runOpenCodeCli`. |
| `src/harness/descriptors/claude.ts` | Claude descriptor: argv/env/mcp-config builders, event parser, extractors, version argv. |
| `src/harness/descriptors/codex.ts` | Codex descriptor. |
| `src/harness/descriptors/opencode.ts` | OpenCode descriptor. |
| `src/harness/descriptors/index.ts` | `DESCRIPTORS: Record<HarnessName, HarnessDescriptor>`. |
| `src/harness/mcp-io-server.ts` | `startMcpIoServer(io)` — in-process localhost HTTP MCP server over `TaskFileIO`. |
| `src/harness/executor.ts` | `runHarnessTask()` and `isHarnessAvailable()` — wires descriptor + subprocess + cwd + MCP. |
| `src/harness/resolve.ts` | Binary resolution + startup discovery: `healedPath`, `resolveHarnessBinary`, `binEnvVar`, `probeHarnessAuth`, `discoverHarnesses`, `applyHarnessDiscovery`. |
| `src/core/agent-step.ts` | `runAgentStep()` — resolves cwd/prompt, starts MCP server, runs executor, captures outputs, tears down. |

### Files to modify

| File | Change |
|---|---|
| `src/providers/opencode.ts` | Replace the inline CLI loop body with a call to `runJsonlSubprocess` (behavior-preserving). |
| `src/core/pipeline-definition.ts` | Add the `agent` entry shape to pipeline types and normalization. |
| `src/core/validation.ts` | Validate the `agent` entry kind through the existing pipeline validation error path. |
| `src/core/pipeline-runner.ts` | In the entry loop, branch to `runAgentStep` when `selectedEntry.agent` is set; record status + token usage. |
| `src/core/orchestrator.ts` | At startup, run a harness preflight (`discoverHarnesses` + `applyHarnessDiscovery`): heal PATH, cache resolved bins, warn (never block) on missing/unauthenticated. |
| `package.json` | Add `@modelcontextprotocol/sdk` dependency. |

### Key contracts (`src/harness/types.ts`)

```ts
export type HarnessName = "claude" | "codex" | "opencode";

export interface McpServerConnection {
  url: string;    // http://127.0.0.1:<port>/mcp
  token: string;  // ephemeral bearer
}

export interface HarnessUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HarnessEvent {
  type: "text" | "tool_call" | "tool_result" | "system" | "result" | "raw";
  raw: unknown;
  text?: string;
  tool?: string;
}

export interface HarnessRunOptions {
  harness: HarnessName;
  prompt: string;
  cwd: string;
  model?: string;
  mcp?: McpServerConnection;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
}

export interface HarnessRunResult {
  finalMessage: string;
  sessionId?: string;
  usage?: HarnessUsage;
  costUsd?: number;
  events: HarnessEvent[];
  exitCode: number;
}

export interface HarnessDescriptor {
  name: HarnessName;
  versionArgv: readonly string[];                       // e.g. ["claude", "--version"]
  binName?: string;                                     // CLI command; defaults to name
  binDirs?: readonly string[];                          // extra install dirs to search, e.g. ["~/.opencode/bin"]
  authStatusArgv?: readonly string[];                   // args for the CLI's own auth check, e.g. ["auth", "status"]
  interpretAuthStatus?(r: { exitCode: number; stdout: string; stderr: string }): boolean | null; // pure; null = can't tell
  buildArgv(o: HarnessRunOptions): string[];
  buildEnv(o: HarnessRunOptions): {
    env: Record<string, string>;
    tmpFiles?: { path: string; content: string }[];     // e.g. generated harness config files
  };
  parseEvents(lines: unknown[]): HarnessEvent[];
  extractFinalMessage(events: HarnessEvent[]): string;
  extractUsage(events: HarnessEvent[]): HarnessUsage | undefined;
  extractCostUsd(events: HarnessEvent[]): number | undefined;
  extractSessionId(events: HarnessEvent[]): string | undefined;
}

export interface AgentEntryConfig {
  harness: HarnessName;
  model?: string;
  prompt?: string;        // exactly one of prompt | promptFrom
  promptFrom?: string;    // job-artifact name to read the prompt from
  cwd?: string;           // default: the step's task directory
  io?: boolean;           // attach MCP artifact server; default true
  timeoutMs?: number;
  captureDiff?: boolean;  // default false; capture git diff of cwd if it is a repo
}

export interface AgentStepResult {
  ok: boolean;
  finalMessage: string;      // empty string on failure before a final message exists
  artifactsWritten: string[];   // names written via MCP and by the agent step itself
  usage?: HarnessUsage;
  costUsd?: number;
  sessionId?: string;
  error?: string;
}
```

### Per-harness argv/env (unrestricted, model, cwd, MCP)

**claude** — `buildArgv`:
```ts
["claude", "-p", prompt,
 "--output-format", "stream-json", "--verbose",
 "--dangerously-skip-permissions",
 ...(model ? ["--model", model] : []),
 ...(mcp ? ["--mcp-config", JSON.stringify({
   mcpServers: { popio: { type: "http", url: mcp.url,
     headers: { Authorization: `Bearer ${mcp.token}` } } } })] : [])]
```
Spawn with `{ cwd }`. `extractUsage`/`extractCostUsd`/`extractSessionId` read the `type:"result"` event (`usage.input_tokens`/`output_tokens`, `total_cost_usd`, `session_id`).

**codex** — `buildArgv`:
```ts
["codex", "exec", prompt, "--json",
 "--dangerously-bypass-approvals-and-sandbox",
 "--skip-git-repo-check",
 "-C", cwd,
 ...(model ? ["-m", model] : []),
 ...(mcp ? [
   "-c", `mcp_servers.popio.url="${mcp.url}"`,
   "-c", 'mcp_servers.popio.bearer_token_env_var="POP_MCP_TOKEN"',
 ] : [])]
```
`buildEnv` (when `mcp`): set `env.POP_MCP_TOKEN = mcp.token`. Do not replace `CODEX_HOME`; the user config/auth store must remain available.

**opencode** — `buildArgv`:
```ts
["opencode", "run", prompt, "--format", "json",
 "--dangerously-skip-permissions",
 "--dir", cwd,
 ...(model ? ["--model", model] : [])]
```
`buildEnv`: `env.OPENCODE_PERMISSION = JSON.stringify([{ permission: "*", pattern: "*", action: "allow" }])`; when `mcp`, write a temp OpenCode config directory containing `opencode.json` with `{ "mcp": { "popio": { "type": "remote", "url": "<mcp.url>", "headers": { "Authorization": "Bearer <token>" }, "enabled": true } } }` and set `env.OPENCODE_CONFIG_DIR = <tmp config dir>`.

### Binary resolution & startup preflight (`src/harness/resolve.ts`)

POP must not depend on the inherited `PATH` to locate the CLIs. GUI/`launchd`/cron launches get a minimal `PATH` that misses user install dirs (e.g. `~/.opencode/bin` is commonly only on the interactive shell's `PATH`), so a bare-name spawn fails with `ENOENT`. This module makes resolution launch-agnostic and self-healing.

```ts
export function healedPath(extraDirs?: readonly string[], basePath?: string): string;  // prepend known, existing bin dirs
export function binEnvVar(name: HarnessName): string;                                   // "opencode" -> "POP_OPENCODE_BIN"
export function resolveHarnessBinary(d: HarnessDescriptor, env?): string | null;        // override env -> which(healed PATH) -> null
export function probeHarnessAuth(d: HarnessDescriptor, binPath: string, env?): Promise<boolean | null>; // advisory, never throws
export function discoverHarnesses(descriptors?, env?): Promise<Record<HarnessName, HarnessProbe>>;
export function applyHarnessDiscovery(probes, env): PreflightMessage[];                 // heal PATH + cache POP_*_BIN; returns warn/info
```

- **Resolution order:** explicit override env var `POP_<HARNESS>_BIN` (absolute path) → `Bun.which(binName, { PATH })` over a *healed* `PATH` (descriptor `binDirs` + a standard set of user/local bin dirs, existing only) → `null`. `Bun.spawn`/`spawnSync` resolve the command against the **passed** `env.PATH`, so the executor also sets `env.PATH = healedPath(d.binDirs)` — healing alone fixes resolution, and the resolved absolute argv[0] is belt-and-suspenders that yields clean not-found errors and powers the auth probe.
- **Auth is advisory, never blocking.** `probeHarnessAuth` runs the CLI's own status command (`codex login status`, `claude auth status` → JSON `{"loggedIn":…}`, `opencode auth list` → `N credentials`) with stdin closed and a short timeout, then a pure `interpretAuthStatus` maps the result to `true | false | null` (`null` whenever undeterminable). A `false`/`null` never stops a run.
- **Startup preflight (orchestrator).** `startOrchestrator` runs `discoverHarnesses()` once, then `applyHarnessDiscovery(probes, process.env)` to heal `process.env.PATH` and cache resolved absolute paths as `POP_<HARNESS>_BIN` — both inherited by spawned job processes (and the agent's own child tools). It logs availability + auth and **warns** on a missing CLI or `authenticated === false`, but never fails startup; the agent step that needs a missing harness fails clearly at run time.

### MCP IO server (`src/harness/mcp-io-server.ts`)

```ts
export interface McpIoServerHandle {
  connection: McpServerConnection;        // { url, token }
  artifactsWritten(): string[];
  close(): Promise<void>;
}
export async function startMcpIoServer(
  io: TaskFileIO,
  opts?: { host?: string },               // default "127.0.0.1"
): Promise<McpIoServerHandle>;
```
- Built on `@modelcontextprotocol/sdk` Streamable HTTP transport, bound to `127.0.0.1` on an ephemeral port.
- Generates a random `token`; every request must carry `Authorization: Bearer <token>` or is rejected with HTTP 401. Fail fast — no anonymous access.
- Tools (all delegate to the passed `io`): `write_artifact(name, content)`, `read_artifact(name)`, `write_log(name, content)`, `write_tmp(name, content)`, `read_tmp(name)`. `write_artifact` records the name in `artifactsWritten()`.

### Executor (`src/harness/executor.ts`)

```ts
export async function runHarnessTask(
  options: HarnessRunOptions,
  deps?: { runJsonlSubprocess?: typeof runJsonlSubprocess },  // injectable for tests
): Promise<HarnessRunResult>;

export function isHarnessAvailable(harness: HarnessName): boolean; // Bun.spawnSync(versionArgv, { timeout: 5000 }), exit 0
```
Resolves the descriptor, builds argv/env (writing any `tmpFiles`), runs `runJsonlSubprocess({ argv, env, cwd, timeoutMs, signal })`, parses events, returns the normalized `HarnessRunResult`. Non-zero exit throws an `Error` carrying stderr; timeout aborts and kills the subprocess (handled inside `runJsonlSubprocess`). Cleans up any temp files in `finally`.

### Agent step (`src/core/agent-step.ts`)

```ts
export async function runAgentStep(
  args: {
    entry: AgentEntryConfig & { name: string };
    workDir: string;
    statusPath: string;
    jobId: string | undefined;
    getStage: () => string;
  },
  deps?: {
    runHarnessTask?: typeof runHarnessTask;
    startMcpIoServer?: typeof startMcpIoServer;
  },
): Promise<AgentStepResult>;
```
Flow:
1. Build a `TaskFileIO` for the step via `createTaskFileIO` (task name = `entry.name`).
2. Resolve `cwd` = `entry.cwd` ?? `io.getTaskDir()`.
3. Resolve prompt = `entry.prompt` ?? `await io.readArtifact(entry.promptFrom)`.
4. If `entry.io !== false`, `startMcpIoServer(io)`; pass `connection` to the executor.
5. `runHarnessTask({ harness, prompt, cwd, model, mcp, timeoutMs, onEvent })`, streaming events as JSONL into `io.writeLog(generateLogName(entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT), ..., { mode: "append" })`.
6. Write `io.writeArtifact("agent-result.md", finalMessage)`.
7. If `entry.captureDiff` and `cwd` is a git work tree, capture `agent.patch` without mutating the real git index: create a temp index file, run `GIT_INDEX_FILE=<tmp> git -C <cwd> read-tree HEAD` when `HEAD` exists or `GIT_INDEX_FILE=<tmp> git -C <cwd> read-tree --empty` when it does not, then `GIT_INDEX_FILE=<tmp> git -C <cwd> add -A` and `GIT_INDEX_FILE=<tmp> git -C <cwd> diff --cached --binary`; write the diff with `io.writeArtifact("agent.patch", diff)` and remove the temp index. If `cwd` is not a repo, skip without error.
8. If the MCP server was started, always `await mcpHandle.close()` in `finally`.
9. Return `AgentStepResult` (merging `artifactsWritten()` from the MCP handle with files written directly).

### Pipeline wiring

- `pipeline-definition.ts` / `validation.ts`: an entry may be a string, a `task` entry, a `gate` entry, or an `agent` entry. Validate: `agent.harness ∈ {claude,codex,opencode}`; exactly one of `agent.prompt` / `agent.promptFrom` present and non-empty; an entry must not set `agent` together with `task` or `gate`. Invalid config throws through `validatePipelineOrThrow()` like existing pipeline-definition errors.
- `pipeline-runner.ts`: in the entry-processing loop, before task delegation, `if (selectedEntry.agent) { result = await runAgentStep(...); mark status; record usage; continue; }`. Status transitions pending→running→done|failed through the same `status-writer` path tasks use. Record a token-usage tuple `[`${harness}:${model ?? "default"}`, usage.inputTokens ?? 0, usage.outputTokens ?? 0, costUsd ?? 0]` on the agent task's `tokenUsage` array so existing UI aggregation can sum it.

### Dependency map

- Internal: `src/core/file-io.ts` (`createTaskFileIO`, `TaskFileIO`, `generateLogName`), `src/config/log-events.ts` (`LogEvent`, `LogFileExtension`), `src/core/pipeline-definition.ts`, `src/core/validation.ts`, `src/core/pipeline-runner.ts`, `src/core/status-writer.ts`, Bun (`Bun.spawn`, `Bun.spawnSync`).
- External: `@modelcontextprotocol/sdk` (new). `git` CLI used only when `captureDiff` is set.

## 5. Acceptance Criteria

Core behavior
- **AC-1** A `pipeline.json` entry with an `agent` object (`harness`, `model`, `prompt`) parses and validates as an agent entry kind.
- **AC-2** `runAgentStep` invokes the harness named in the entry, with the given `model` and resolved `cwd`, exactly once for a successful run.
- **AC-3** Each descriptor's `buildArgv` / `buildEnv` includes the harness's unrestricted control (claude `--dangerously-skip-permissions`; codex `--dangerously-bypass-approvals-and-sandbox`; opencode `--dangerously-skip-permissions` plus `OPENCODE_PERMISSION` allow-all), the model (when provided), the working directory, and — when `mcp` is set — the MCP connection in the harness's documented form.
- **AC-4** When the agent calls the MCP `write_artifact` tool, the content is persisted through `TaskFileIO` and the artifact name appears in `tasks-status.json` files and in `AgentStepResult.artifactsWritten`.
- **AC-5** The MCP server binds to `127.0.0.1` only and rejects any request lacking the correct `Authorization: Bearer <token>` with HTTP 401.
- **AC-6** `HarnessRunResult` exposes `finalMessage`, and `sessionId` / `usage` / `costUsd` when the harness emits them (and `undefined` when it does not).
- **AC-7** Harness events are written during the run as JSONL content to the task log named by `generateLogName(entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT)`.
- **AC-8** `isHarnessAvailable(name)` returns the result of a non-interactive `--version` check and never blocks on input.

Error handling & edge cases
- **AC-9** A non-zero harness exit causes `runHarnessTask` to throw an error whose message includes captured stderr, and `runAgentStep` returns `{ ok: false, error }`.
- **AC-10** When `timeoutMs` elapses, the subprocess is killed and the call rejects/aborts rather than hanging.
- **AC-11** Invalid agent config fails validation deterministically: missing/unknown `harness`, neither `prompt` nor `promptFrom`, both `prompt` and `promptFrom`, an entry that sets both `gate` and `agent`, or an entry that sets both `task` and `agent`.
- **AC-12** The MCP server is closed on every exit path of `runAgentStep` (success, harness failure, and timeout).
- **AC-13** `captureDiff: true` writes an `agent.patch` artifact when `cwd` is a git work tree, includes tracked and untracked working-tree changes, does not change the real git index, and is skipped without error when `cwd` is not a repository.

Integration
- **AC-14** An `agent` entry processed by the pipeline runner transitions pending→running→done in `tasks-status.json` and is observable like a task entry.
- **AC-15** A completed agent step records a token-usage tuple keyed `${harness}:${model ?? "default"}` (zeros when usage/cost are unavailable) in the job's usage aggregation.
- **AC-16** The OpenCode chat provider's CLI path still parses JSONL events and returns the same `AdapterResponse` after being refactored onto `runJsonlSubprocess` (no behavior change).

Binary resolution & preflight
- **AC-17** `resolveHarnessBinary` returns the `POP_<HARNESS>_BIN` override when it points at an existing file, else the CLI found via `Bun.which` over a healed `PATH` (including descriptor `binDirs`), else `null` — and the executor runs the harness even when the CLI is not on the inherited `PATH`.
- **AC-18** When the CLI cannot be resolved and the spawn fails with `ENOENT`, `runHarnessTask` throws an error naming the harness, the searched locations, and the `POP_<HARNESS>_BIN` override var.
- **AC-19** `discoverHarnesses` returns, per harness, an absolute `binPath` (or `null`), `available`, and an advisory `authenticated` (`true`/`false`/`null`) derived from the CLI's own status command; the auth result never blocks a run.
- **AC-20** The orchestrator startup preflight heals `process.env.PATH`, caches resolved bins as `POP_<HARNESS>_BIN`, and emits a warning (not a failure) for any missing or unauthenticated harness.

## 6. Notes

- **Full-auto is a product decision, not an oversight.** The user's model is high-trust: once POP invokes a harness it must never prompt. This spec encodes unrestricted execution and rejects the deny-by-default posture used for the *chat* providers. Trade-off: it removes the sandbox safety net, so `cwd` is the effective blast radius. Mitigation kept lightweight: `cwd` defaults to the step's task directory; operators who modify a real repo should point `cwd` at it (optionally a dedicated checkout/worktree). Claude additionally retains a hard circuit-breaker on `.git`/protected paths even under bypass.
- **HTTP MCP, not stdio.** The MCP server must share the step's in-process `TaskFileIO` closure; a stdio server would be a separate process without it. Localhost binding + ephemeral bearer token contains exposure. Alternative (stdio with a side channel to POP) was rejected as more moving parts for no gain.
- **CLI-only, no SDKs.** SDKs add no agent capability — `@openai/codex-sdk` spawns the `codex` CLI itself. CLI keeps the three harnesses uniform and dependencies minimal. Only `@modelcontextprotocol/sdk` (server side) is added.
- **Launch-agnostic by design.** Operators must never have to change how POP is started (export `PATH`, source a shell rc) to make the harnesses resolve. POP heals this itself: it discovers the CLIs at known install dirs, caches absolute paths, and heals `PATH` for the agent's own child tools. The `POP_<HARNESS>_BIN` override is the escape hatch for non-standard installs. Auth is checked via each CLI's own status command (no credential-file/keychain guessing) and is advisory only.
- **Shared executor abstraction.** `runHarnessTask` + the MCP server are shared across all three harnesses; each harness is a ~30-line descriptor. This abstraction is justified by three real consumers, unlike the chat-provider shape the earlier proposal declined to unify.
- **OpenCode MCP config delivery.** The local `opencode` 1.17.4 CLI exposes `--dangerously-skip-permissions` on `opencode run`, and OpenCode supports `OPENCODE_CONFIG_DIR` for a custom config directory. The descriptor therefore owns the temp config directory and unit tests assert the generated `opencode.json` object shape and env wiring, not live MCP connectivity.
- **Out of scope (deferred follow-up):** the OpenCode-integration drift from #302 — `validateEnvironment()` not recognizing harness availability, and missing README/`pop-task-guide.md` entries — is a separate small change and is intentionally not specced here to keep this spec coherent around the agent stage.
- **Sequencing:** types → subprocess extraction → descriptors → MCP server → executor → agent step → validation → runner wiring → binary resolution & startup preflight. The MCP server (step 5) requires the new dependency before the executor and agent step can be tested end to end. The resolution/preflight step (step 11) layers onto the descriptors and executor and is independent of the MCP server.

## 7. Implementation Steps

1. **Add shared types.** Create `src/harness/types.ts` with every interface in §4 (`HarnessName`, `HarnessRunOptions`, `HarnessRunResult`, `HarnessEvent`, `HarnessUsage`, `McpServerConnection`, `HarnessDescriptor`, `AgentEntryConfig`, `AgentStepResult`). Why: every later module imports these. Tests: a type-only test file that constructs each shape (compile-time). Covers: AC-1, AC-3 (contract surface).

2. **Extract the JSONL subprocess runner.** Create `src/harness/subprocess.ts` exporting `runJsonlSubprocess({ argv, env, cwd?, timeoutMs, signal? }) → Promise<{ events: unknown[]; stdout: string; stderr: string; exitCode: number; timedOut: boolean }>`, lifted from `runOpenCodeCli` ([src/providers/opencode.ts:315-386](../../src/providers/opencode.ts)): spawn, pipe stdout/stderr, timeout-kill, parse each non-empty line as JSON (skip unparseable), return collected events. Why: removes duplication and gives every harness one tested subprocess path. Tests (`src/harness/__tests__/subprocess.test.ts`): a command emitting two JSONL lines yields two parsed events; a malformed line is skipped, not thrown; a sleeping command past `timeoutMs` resolves with `timedOut: true` and the process is killed; non-zero exit is reported via `exitCode`/`stderr`. Covers: AC-9, AC-10.

3. **Refactor OpenCode CLI path onto the shared runner.** In `src/providers/opencode.ts`, replace the body of `runOpenCodeCli` with a call to `runJsonlSubprocess` and keep the existing text/event extraction and error semantics. Why: proves the extraction is behavior-preserving and pays down duplication. Tests: extend `src/providers/__tests__/opencode.test.ts` to assert the CLI-mode `AdapterResponse` (content/text/raw) is unchanged against the existing fixtures, and that a non-zero exit still throws with stderr detail. Covers: AC-16.

4. **Implement the three descriptors.** Create `src/harness/descriptors/{claude,codex,opencode}.ts` and `index.ts` exporting `DESCRIPTORS`. Each implements `HarnessDescriptor` per §4 (argv with the unrestricted flag + model + cwd; env/tmpFiles for MCP; `parseEvents`; `extractFinalMessage`/`extractUsage`/`extractCostUsd`/`extractSessionId`; `versionArgv`). Why: isolates per-harness specifics behind a uniform contract while keeping the required `Record<HarnessName, HarnessDescriptor>` complete in one compile-safe step. Tests (`src/harness/__tests__/descriptors.test.ts`): for each harness, `buildArgv` contains the unrestricted flag, `--model`/`-m` value when model given and omits it when absent, and the cwd flag where applicable; codex `buildArgv` includes `--skip-git-repo-check` and MCP `-c` overrides while `buildEnv` sets `POP_MCP_TOKEN`; opencode `buildArgv` includes `--dangerously-skip-permissions`, `buildEnv` sets the normalized allow-all `OPENCODE_PERMISSION`, writes `opencode.json`, and sets `OPENCODE_CONFIG_DIR`; claude `buildArgv` includes a `--mcp-config` JSON with `type:"http"`, the url, and a bearer `Authorization` header; extractors return usage/cost/session from fixture event arrays and `undefined` when absent. Covers: AC-3, AC-6, AC-8.

5. **Implement the MCP IO server.** Add `@modelcontextprotocol/sdk` to `package.json`. Create `src/harness/mcp-io-server.ts` with `startMcpIoServer(io, opts?)` per §4: Streamable HTTP transport bound to `127.0.0.1`, ephemeral port and bearer token, tools `write_artifact`/`read_artifact`/`write_log`/`write_tmp`/`read_tmp` delegating to `io`, bearer-token enforcement, `artifactsWritten()` tracking, and `close()`. Why: the agent's report-back channel into POP artifacts. Tests (`src/harness/__tests__/mcp-io-server.test.ts`, with a fake `TaskFileIO`): a `write_artifact` tool call with the correct bearer token invokes `io.writeArtifact` and appears in `artifactsWritten()`; a request with a missing/wrong token returns 401 and does not touch `io`; the bound address is `127.0.0.1`; `close()` stops the listener (a subsequent request fails to connect). Covers: AC-4, AC-5, AC-12.

6. **Implement the executor.** Create `src/harness/executor.ts` with `runHarnessTask(options, deps?)` and `isHarnessAvailable(name)` per §4: resolve descriptor, build argv/env (write tmpFiles, clean up in `finally`), run `runJsonlSubprocess`, parse events, return normalized `HarnessRunResult`; throw with stderr on non-zero exit; abort on timeout. Why: the single entry point the agent step calls. Tests (`src/harness/__tests__/executor.test.ts`, injecting a fake `runJsonlSubprocess`): a successful run returns `finalMessage`/`usage`/`costUsd`/`sessionId` from parsed events; a non-zero `exitCode` throws an error containing stderr; a `timedOut` result rejects; `onEvent` is called per event; `isHarnessAvailable` returns true/false from a stubbed `spawnSync` exit code. Covers: AC-2, AC-6, AC-8, AC-9, AC-10.

7. **Implement the agent step core.** Create `src/core/agent-step.ts` with `runAgentStep(args, deps?)` per §4: build `TaskFileIO`, resolve cwd and prompt (`prompt` or `readArtifact(promptFrom)`), start MCP server when `io !== false`, run the executor while appending JSONL events to `generateLogName(entry.name, "agent", LogEvent.DEBUG, LogFileExtension.TEXT)`, write `agent-result.md`, close the MCP server in `finally`, and return `AgentStepResult`. Why: orchestrates one observable agent step without the optional git-diff branch. Tests (`src/core/__tests__/agent-step.test.ts`, injecting fake `runHarnessTask` and `startMcpIoServer`): success writes the event log + `agent-result.md` and returns `ok:true` with usage/cost; `promptFrom` reads the named artifact for the prompt; a thrown executor error yields `ok:false` with the error and still calls `mcpHandle.close()`; the MCP server is closed on success, failure, and timeout paths. Covers: AC-4, AC-6, AC-7, AC-12.

8. **Add optional diff capture.** Extend `src/core/agent-step.ts` so `captureDiff:true` writes `agent.patch` using a temporary git index per §4 and skips without error when `cwd` is not a git repository. Why: diff capture is useful but must not stage or otherwise mutate operator repositories. Tests (`src/core/__tests__/agent-step.test.ts`): a repo cwd with tracked and untracked changes writes `agent.patch`; a repo with no `HEAD` captures changes against an empty tree; the real index is unchanged after capture; a non-repo cwd does not throw and writes no patch. Covers: AC-13.

9. **Validate the `agent` entry kind.** In `src/core/pipeline-definition.ts`, extend entry types/normalization to accept `agent`; in `src/core/validation.ts`, enforce the §4 rules through `validatePipelineOrThrow()`. Why: malformed agent steps must fail before execution through the same validation surface as existing pipeline entries. Tests (`src/core/__tests__/pipeline-definition.test.ts` and/or `src/core/__tests__/validation.test.ts`): a valid agent entry parses; each invalid case throws the validation error — unknown/missing `harness`, neither `prompt` nor `promptFrom`, both `prompt` and `promptFrom`, an entry setting both `gate` and `agent`, and an entry setting both `task` and `agent`. Covers: AC-1, AC-11.

10. **Wire the runner.** In `src/core/pipeline-runner.ts`, branch the entry loop to `runAgentStep` when `selectedEntry.agent` is set, write status transitions through the existing `status-writer` path, and record the `${harness}:${model ?? "default"}` token-usage tuple on the task's `tokenUsage` array. Why: makes the entry kind executable and observable end to end. Tests (`src/core/__tests__/pipeline-runner.test.ts` or the runner's existing suite, injecting a fake `runAgentStep`): an `agent` entry drives `tasks-status.json` pending→running→done; a failing agent step marks the entry failed; the recorded usage tuple is keyed `${harness}:${model ?? "default"}` with zeros when usage is absent. Covers: AC-14, AC-15.

11. **Resolve binaries & add the startup preflight.** Create `src/harness/resolve.ts` (`healedPath`, `binEnvVar`, `resolveHarnessBinary`, `probeHarnessAuth`, `discoverHarnesses`, `applyHarnessDiscovery`); add `binName`/`binDirs`/`authStatusArgv`/`interpretAuthStatus` to the three descriptors; have `runHarnessTask` resolve the CLI to an absolute path and set `env.PATH = healedPath(d.binDirs)` (with a clear not-found error), and `isHarnessAvailable` run its version check over the healed `PATH`; wire `harnessPreflight` into `startOrchestrator`. Why: makes the harnesses resolve and report regardless of how POP was launched, without operator `PATH` changes. Tests (`src/harness/__tests__/resolve.test.ts`, plus executor cases): `healedPath` prepends existing dirs and dedupes; `resolveHarnessBinary` honors the override, resolves via `binDirs`, and returns `null` when absent; each descriptor's `interpretAuthStatus` maps fixtures to `true`/`false`/`null`; `discoverHarnesses` reports availability + auth using a temp fake CLI; `applyHarnessDiscovery` heals PATH, caches bins, and warns without blocking; the executor spawns the resolved absolute path with a healed PATH and throws a clear error when missing. Covers: AC-17, AC-18, AC-19, AC-20.

## 8. Applicable Rules

- `~/.agents/rules/unit-testing.md` — every step adds unit tests; the spec requires boundary mocking (subprocess, MCP server, HTTP), deterministic failure-mode coverage, and global-state cleanup for spawned servers/temp files.

Spec folder: .specs/303-cli-agent-harness-stage/
