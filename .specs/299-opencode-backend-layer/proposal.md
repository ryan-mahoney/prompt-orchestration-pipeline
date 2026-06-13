# Implementation Proposal: OpenCode Backend Layer

## Problem Restatement

The project currently calls LLM providers directly through `src/llm/index.ts` and `src/providers/`. The proposed change is to put POP on top of OpenCode so users authenticate through OpenCode, POP can stop maintaining a broad model catalog, and pipeline tasks can benefit from an LLM harness with sessions, agents, tools, MCP, and structured output. The trigger remains normal POP execution: a pipeline runner executes task stages, and an inference stage calls `context.llm`. The expected changes are in provider/model routing, auth assumptions, observability, and possibly task execution semantics.

Assumption: this proposal targets OpenCode as an execution backend while preserving POP's watch-folder orchestration, task lifecycle, run controls, artifacts, status files, and SSE dashboard.

## Summary

Add OpenCode as a first-class POP provider/backend, but do not replace POP's orchestration layer in the first implementation. POP should keep owning deterministic pipeline execution, status persistence, gates, retries, artifacts, and UI observability. OpenCode should initially sit behind the existing LLM provider contract through a new `opencode` adapter that can use OpenCode's server/SDK for structured responses and, optionally, CLI `opencode run --format json` for non-interactive event streaming. A later phase can explore delegating whole POP tasks to configured OpenCode agents once the provider-level contract is proven stable.

## Verdict: COMPATIBLE WITH CAVEATS

This fits the existing architecture because POP already has a provider abstraction and an existing CLI-harness precedent in `src/providers/claude-code.ts`. It is not a clean replacement for the whole system because POP's core value is orchestration and observability, while OpenCode's core value is the model/tool harness. Treating OpenCode as another backend is compatible; making POP merely a thin wrapper around OpenCode's sessions is an architectural rewrite.

Caveats:

- OpenCode's CLI `--format json` is an event/output format, not necessarily a model JSON-schema contract. For POP's `responseFormat` behavior, prefer OpenCode's SDK/server structured output path when a JSON schema is requested.
- POP must not implicitly start unmanaged long-running OpenCode servers. Either attach to a user/supervisor-managed `opencode serve` instance or run short-lived CLI commands with explicit timeouts.
- Tool access changes the security model. The safe default should be model-only or deny-by-default permissions until a task explicitly opts into tools.
- POP's cost and token accounting may become less precise unless OpenCode exposes per-message usage in a stable response shape.

## Critique Recommended: YES

This introduces a new dependency, a new backend process/API surface, a new local credential trust boundary, and a side-effect-capable agent harness, so a second architecture critique is worth the cost.

## Why Do This?

### Reduce provider-maintenance burden

OpenCode uses AI SDK plus Models.dev for broad provider/model support and exposes model listing through `opencode models`. POP's current `src/config/models.ts` hard-codes provider names, model aliases, and costs. Moving model resolution to OpenCode means POP can maintain a small adapter contract instead of chasing every provider's newest model naming, pricing, JSON-mode quirks, and auth scheme.

External context checked June 12, 2026:

- OpenCode provider docs: https://opencode.ai/docs/providers/
- OpenCode model docs: https://opencode.ai/docs/models/
- OpenCode CLI docs: https://opencode.ai/docs/cli/

### Let users reuse OpenCode auth

OpenCode supports provider login and stores credentials in its local auth store. POP currently loads `.env` files and checks provider-specific env vars in `src/core/environment.ts` and `src/llm/index.ts`. An OpenCode backend lets users configure credentials once in OpenCode and keeps POP from directly handling most LLM provider secrets.

This does not eliminate credential risk. It moves the boundary to OpenCode's auth store and any OpenCode server credentials.

### Gain a real harness

OpenCode has sessions, agents, tools, MCP, permissions, server APIs, event streams, and an SDK. POP currently provides a deterministic pipeline harness, but each inference call is basically a normalized chat request. OpenCode can provide richer model interaction without POP building all of that itself.

### Preserve POP's actual moat

POP's differentiator is not "can call GPT/Claude/Gemini." It is file-based orchestration, process isolation, resumability, task gates, per-stage logs, structured artifacts, and deterministic task lifecycle. Using OpenCode under `context.llm` strengthens POP without giving up those properties.

## Why Not Do This?

### OpenCode is an agent harness, not just a stateless chat API

POP's provider contract expects deterministic-ish request/response behavior: `messages`, `model`, `responseFormat`, retries, normalized `content`, normalized usage, and emitted metrics. OpenCode sessions and agents can add hidden context, tool calls, and project state. That is powerful, but it can make POP runs less repeatable unless the adapter is deliberately stateless by default.

### Tool side effects can bypass POP observability

If an OpenCode agent reads, edits, or shells directly in the repository, those actions may not flow through `TaskFileIO`, `tasks-status.json`, stage logs, artifact tracking, or run controls. That conflicts with the current "deterministic, observable, easy to stop" operating model.

### Output contract risk

Provider requirements in `docs/provider-requirements.md` require JSON-mode enforcement and `ProviderJsonParseError` on invalid JSON. OpenCode's SDK documents structured JSON output, while the CLI documents raw JSON events. Those are different contracts. If POP parses CLI events and prompts for JSON manually, it can regress on schema enforcement.

### Cost tracking may degrade

`src/core/task-runner.ts` appends token usage tuples from `llm:request:complete` metrics, and `src/llm/index.ts` calculates cost from `MODEL_CONFIG`. If OpenCode is the model layer, POP may only have estimates unless it can reliably map OpenCode response metadata back to prompt tokens, completion tokens, and model pricing.

### Runtime lifecycle can get awkward

OpenCode server mode is an HTTP server, and the local AGENTS.md says not to start long-running background processes without explicit user control. POP should not silently spin up `opencode serve` in the background. A server-backed integration needs explicit configuration and clear operational docs.

### It may collapse two useful abstractions

POP stages are explicit: `ingestion`, `promptTemplating`, `inference`, validation, critique, refine, integration. OpenCode agents are more autonomous. Letting agents perform whole tasks too early may make task behavior harder to test and replay.

## Affected Areas

- `src/providers/opencode.ts` - New provider adapter using OpenCode SDK/server first, with optional CLI mode if intentionally configured.
- `src/providers/types.ts` - Add `opencode` provider types and options, including agent, session, tools/permissions, attach URL, structured format, and working directory controls.
- `src/llm/index.ts` - Dispatch `provider: "opencode"`, emit existing metrics, estimate or map usage, and include availability detection.
- `src/config/models.ts` - Add `opencode` as a provider without mirroring the full OpenCode model catalog. Prefer one `opencode:default` alias plus dynamic `model: "provider/model"` routing through `llm.chat`.
- `src/core/environment.ts` - Treat OpenCode availability as an alternative to direct provider API keys when configured, without reading or copying OpenCode credentials.
- `docs/provider-requirements.md` - Document the special OpenCode contract: structured output path, tool permissions, process/server lifecycle, and usage fallback.
- `docs/pop-task-guide.md` - Show how a task calls `llm.chat({ provider: "opencode", model: "anthropic/claude-sonnet-4-5", ... })`.
- `README.md` - Update provider list and explain OpenCode setup at a high level.
- `package.json` / `bun.lock` - Add `@opencode-ai/sdk` only if the implementation uses the SDK rather than direct HTTP calls.
- `src/providers/__tests__/opencode.test.ts` - New adapter tests.
- `src/llm/__tests__/index.test.ts` - Dispatch, metrics, availability, model override, and JSON inference coverage.
- `src/config/__tests__/models.test.ts` - Registry invariants for the new provider.
- `tests/core/*` only if model override or token usage serialization changes.

## Implementation Steps

### 1. Define the OpenCode integration mode

Start with a provider-level backend, not whole-task delegation.

Recommended modes:

- `server` mode: connect to an existing OpenCode server through `OPENCODE_BASE_URL` or `PO_OPENCODE_BASE_URL`. This is the preferred mode for SDK structured output and long-running production use.
- `cli` mode: run `opencode run --format json` as a bounded subprocess for prototypes and environments that do not run a server.

Do not start `opencode serve` implicitly from a provider call in the first implementation. If later needed, make it an explicit command or supervisor-managed deployment path.

Pattern reference: follow the subprocess lifecycle discipline from `src/providers/claude-code.ts`, but prefer the SDK/server path for structured output.

### 2. Add a narrow `opencode` provider adapter

Create `src/providers/opencode.ts` exporting:

- `opencodeChat(options: OpenCodeOptions): Promise<AdapterResponse>`
- `isOpenCodeAvailable(): boolean | Promise<boolean>`

Adapter behavior:

- Validate messages with `ensureMessagesPresent`.
- Convert POP `ChatMessage[]` into OpenCode prompt/session input.
- Use a fresh OpenCode session per call by default.
- Allow an explicit session id only through provider-specific options or metadata.
- Map POP `responseFormat` to OpenCode SDK structured output when it is a JSON schema.
- For simple `json` / `json_object`, pass a strict JSON instruction and still parse with `tryParseJSON`.
- Strip markdown fences before parsing.
- Return `AdapterResponse` with parsed `content`, raw text in `text`, stable `raw`, and usage if available.
- Fall back to token estimates when usage is unavailable.
- Use `requestTimeoutMs`, abort signals, and child-process kill behavior.

### 3. Wire the provider through the existing LLM gateway

Update:

- `src/providers/types.ts`
- `src/llm/index.ts`
- `src/config/models.ts`

The important design choice: do not import OpenCode's whole model list into `MODEL_CONFIG`. Add a minimal `opencode:default` alias and support direct dynamic calls:

```ts
await llm.chat({
  provider: "opencode",
  model: "anthropic/claude-sonnet-4-5",
  messages,
  responseFormat,
});
```

That avoids reproducing the model-catalog maintenance problem under a new name.

### 4. Preserve POP's safety and observability defaults

Default OpenCode config for POP calls should be:

- fresh session per request
- no tool side effects unless explicitly opted in
- deny-by-default or model-only permissions
- working directory set to the POP job/task directory, not necessarily the repository root
- no `--dangerously-skip-permissions`
- no implicit background server startup

If a task opts into agent/tool behavior, the task should write all intended outputs through POP artifacts or a clearly documented handoff directory that POP tracks.

### 5. Keep direct providers during migration

Do not delete `openai`, `anthropic`, `gemini`, `deepseek`, `moonshot`, `zai`, `alibaba`, or `claude-code` in the first phase.

Reason:

- Direct providers are the rollback path.
- They are useful for tests and deterministic baselines.
- They keep POP usable where OpenCode is not installed or not authenticated.

After OpenCode has parity in real pipelines, reassess whether to deprecate direct providers.

### 6. Add contract tests before expanding surface area

Add tests that lock the provider boundary, not OpenCode internals:

- `opencodeChat` parses structured JSON responses.
- Invalid JSON in JSON mode throws `ProviderJsonParseError`.
- Non-zero CLI exit or SDK error preserves useful error details.
- Availability checks do not prompt.
- Timeouts abort the request and clean up processes.
- Usage is normalized when present and estimated when absent.
- `llm:request:complete` still emits provider/model/cost fields.
- Tool permissions are denied or omitted by default.

## Data Changes

No database or file-schema migration is required for the first provider-level implementation.

Potential status-file behavior change:

- `tasks-status.json` token usage may include `opencode:<provider/model>` keys with estimated token counts or zero cost until exact usage is available.

No changes should be made to `pipeline.json` schema in phase 1. Existing pipeline-level `llm` overrides can route to `{ "provider": "opencode", "model": "anthropic/claude-sonnet-4-5" }`.

## New Dependencies

Recommended:

- `@opencode-ai/sdk` - Use this if implementing the server/SDK path for structured output and OpenAPI-generated types.

Optional:

- No dependency for CLI-only mode, but CLI-only mode should not be the primary implementation because it is weaker for JSON schema enforcement.

No new database, queue, or background worker infrastructure is required.

## Testing Strategy

Use Bun/Vitest patterns already present in `src/providers/__tests__/claude-code.test.ts` and `src/llm/__tests__/index.test.ts`.

Provider tests:

- Mock SDK client calls and CLI subprocesses.
- Use fixtures that resemble OpenCode message/part responses.
- Verify structured output extraction separately from plain text extraction.
- Verify permissions/tool defaults are encoded in the request.

Gateway tests:

- Register and dispatch `provider: "opencode"`.
- Verify `createLLMWithOverride({ provider: "opencode", model: "..." })`.
- Verify provider availability shape includes `opencode`.
- Verify cost calculation returns zero or estimated cost without crashing for dynamic OpenCode models.

Integration smoke test:

- Add a skipped-by-default test or documented manual check that runs against a real authenticated OpenCode setup.
- Keep it out of normal CI unless CI has a non-interactive OpenCode server fixture.

## Edge Cases & Risks

### Risk: JSON schema parity is incomplete

Mitigation: Prefer SDK/server structured output for schema mode. Treat CLI JSON events as transport events only. Keep `ProviderJsonParseError` behavior at the POP boundary.

### Risk: OpenCode tools mutate files outside POP tracking

Mitigation: Disable tools by default. When tools are enabled, restrict working directory to the task directory or a tracked scratch directory, and require integration stages to copy final outputs into POP artifacts.

### Risk: Long-running server lifecycle violates repo operating rules

Mitigation: Require `OPENCODE_BASE_URL` for server mode. Document that users start `opencode serve` themselves or run it under a process manager. Do not hide server startup inside `opencodeChat`.

### Risk: Auth assumptions are wrong on another machine

Mitigation: Availability checks should verify OpenCode is installed and reachable, then report a clear "run opencode auth login" style message without prompting. Never read or commit `~/.local/share/opencode/auth.json`.

### Risk: Model selection becomes opaque

Mitigation: Surface `opencode models` as documentation and maybe a UI helper later. Do not maintain a duplicate list in `src/config/models.ts`.

### Risk: Cost reporting regresses

Mitigation: Preserve token estimates and mark cost as `0` or `unknown` for dynamic OpenCode models unless exact usage and pricing are available. Consider a later cost adapter using OpenCode stats/session metadata if stable.

### Risk: Session state breaks repeatability

Mitigation: Fresh session per POP call by default. Continuing or forking sessions must be explicit in task config or metadata and recorded in logs.

### Risk: OpenCode version drift changes event shapes

Mitigation: Pin a tested minimum OpenCode version in docs, add parser fixtures, and make parser errors clear. Prefer SDK types where possible.

## Alternative Approaches

### Alternative A: Add only an OpenCode provider adapter

This is the recommended first step. It gives POP OpenCode auth/model support while preserving POP orchestration and minimizing blast radius.

Tradeoff: POP still owns provider abstraction code, and some OpenCode harness benefits remain unused.

### Alternative B: Delegate whole POP tasks to OpenCode agents

Each POP task could map to an OpenCode agent invocation, with POP mostly supervising sessions and collecting outputs.

Tradeoff: More harness value, but weaker determinism, harder artifact tracking, and more risk that tool calls bypass POP's stage lifecycle.

### Alternative C: Keep direct providers and only add model-catalog helpers

POP could call OpenCode only to list models or manage auth guidance, while provider calls remain direct.

Tradeoff: Lower risk, but it does not deliver the main auth and harness benefits.

## Recommendation

Move forward, but start with Alternative A. Add OpenCode as a backend under the existing LLM provider interface, preserve all existing providers, and explicitly prohibit tool side effects by default. Treat full OpenCode-agent task delegation as a later experiment after the adapter proves it can preserve POP's JSON contract, observability, process cleanup, and retry behavior.

