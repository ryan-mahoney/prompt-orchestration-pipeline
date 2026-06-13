# Implementation Proposal: CLI Agent Harness Stage

## Problem Restatement

POP can call LLM providers as **chat backends** through `src/llm/index.ts` and `src/providers/`. The OpenCode provider added in #302 is deliberately a muzzled chat backend: deny-by-default permissions (`{ "*": "deny" }`), tools off, returns only the final message. POP cannot currently let an agentic CLI harness *do work* — search files, run tools, run skills, modify code — and capture what it did.

This proposal adds a new pipeline **entry kind** (`agent`, parallel to `task`/`gate`) that runs a CLI agent harness (`claude`, `codex`, or `opencode`) at a chosen model, fully unrestricted, in a working directory, connected to a local MCP server that lets the agent write POP artifacts the same way a normal stage does. This is the proposal-#299 "Alternative B" (delegate work to the agent), scoped to step granularity so it stays observable.

## Verdict: COMPATIBLE

POP already has a non-task entry kind (`gate`) handled directly by the pipeline runner ([pipeline-runner.ts:455-469](../../src/core/pipeline-runner.ts)), a per-task directory layout, artifact tracking through `TaskFileIO`, and status persistence. The agent entry kind reuses all of it. The CLI subprocess discipline already exists in `src/providers/opencode.ts` and `src/providers/claude-code.ts`.

## Key decisions

1. **Three harnesses, one uniform surface.** All of `claude`, `codex`, `opencode` support: full-auto/unrestricted execution, model selection, machine-readable event output, a working directory, and connecting to an HTTP MCP server. Verified flags:
   - claude: `--dangerously-skip-permissions`, `--model`, `--output-format stream-json --verbose`, cwd, `--mcp-config` (http url + headers).
   - codex: `--dangerously-bypass-approvals-and-sandbox`, `-m`, `--json`, `-C/--cd`, MCP via `CODEX_HOME/config.toml` `mcp_servers` (http `url` + `bearer_token_env_var`).
   - opencode: permission `{ "*": "allow" }`, `--model provider/model`, `--format json`, `--dir`, MCP via generated config (remote/http server).

2. **Full-auto by design.** The trust boundary is crossing into a harness at all; once POP invokes one, it never prompts the user. The working directory is therefore the only blast radius (claude additionally keeps a hard circuit-breaker on `.git`/protected paths).

3. **Local MCP artifact server.** POP runs one in-process localhost HTTP MCP server, scoped to the step's `TaskFileIO`, with an ephemeral bearer token. It exposes `write_artifact` / `read_artifact` / `write_log` / `write_tmp` / `read_tmp` — the agent writes artifacts through the exact `TaskFileIO` code path a stage uses. Precedent: the in-process HTTP/SSE server from #301.

4. **CLI-only, no SDKs.** SDKs add no agent capability (the `@openai/codex-sdk` literally spawns the `codex` CLI). CLI keeps deps minimal and the three harnesses uniform.

5. **Shared executor abstraction is now justified.** `runHarnessTask()` + the MCP server are shared across all three harnesses; each harness shrinks to a ~30-line descriptor (argv/env/config builder, event parser, extractors). This is the abstraction the earlier proposal deferred because the chat-provider shape did not justify it; the executor shape does.

## Out of scope

- The existing `opencode` / `claude-code` **chat** providers are untouched — they remain tools-off model backends for the `inference` stage. Two verbs, separated.
- OpenCode-integration drift cleanup (environment.ts availability, README/task-guide) is a separate small follow-up, noted but not specced here.

Spec folder: .specs/303-cli-agent-harness-stage/
