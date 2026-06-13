# Implementation Spec: OpenCode Prompt Runner Provider

## 1. Qualifications

- TypeScript provider adapter design
- Bun subprocess and timeout handling
- OpenCode SDK/server integration
- JSON-schema structured-output handling
- Provider gateway telemetry and cost normalization
- Vitest/Bun unit testing

## 2. Problem Statement

POP currently runs prompts through direct provider adapters in `src/providers/` and a static model registry in `src/config/models.ts`. The decided approach is to keep POP's existing orchestration system intact and add OpenCode only as an optional prompt execution backend. This spec covers phase 1: `provider: "opencode"` support for `llm.chat`, not delegation of whole POP tasks to OpenCode agents.

## 3. Goal

Implement an OpenCode provider adapter that runs POP prompt requests through OpenCode while preserving POP's task lifecycle, JSON response contract, metrics events, status token usage, and safe-by-default execution boundaries.

## 4. Architecture

### Files To Create

- `src/providers/opencode.ts` - OpenCode provider adapter, availability checks, SDK/CLI execution, response extraction, JSON parsing, usage normalization, and timeout cleanup.
- `src/providers/__tests__/opencode.test.ts` - Contract tests for the adapter, including structured output, plain JSON parsing, failures, timeouts, availability, and default permissions.

### Files To Modify

- `src/providers/types.ts` - Add `opencode` to provider names and availability; add OpenCode-specific request config and adapter options.
- `src/llm/index.ts` - Import and dispatch `opencodeChat`, include availability, preserve metrics, usage, and cost behavior.
- `src/config/models.ts` - Add only `opencode:default` as the registry alias; do not mirror OpenCode's full model list.
- `src/config/__tests__/models.test.ts` - Update model/provider counts and assert the OpenCode alias has zero static pricing.
- `src/llm/__tests__/index.test.ts` - Cover gateway dispatch, availability, dynamic model cost fallback, and model override behavior for `opencode`.
- `package.json` and `bun.lock` - Add `@opencode-ai/sdk`.
- `docs/current-architecture.md` - Reference the local decision that OpenCode is a prompt-runner option, not a replacement orchestrator.
- `docs/provider-requirements.md` - Reference the local decision and summarize the special OpenCode constraints.

### Key Contracts

```ts
export type ProviderName =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "zai"
  | "zhipu"
  | "claudecode"
  | "moonshot"
  | "alibaba"
  | "opencode"
  | "mock";

export type OpenCodePermissionAction = "allow" | "ask" | "deny";

export type OpenCodePermissionKey =
  | "read"
  | "edit"
  | "glob"
  | "grep"
  | "list"
  | "bash"
  | "task"
  | "external_directory"
  | "todowrite"
  | "webfetch"
  | "websearch"
  | "lsp"
  | "skill"
  | "question"
  | "doom_loop";

export type OpenCodePermissionName =
  | OpenCodePermissionKey
  | "*"
  | (string & {});

export interface OpenCodePermissionRule {
  permission: OpenCodePermissionName;
  pattern: string;
  action: OpenCodePermissionAction;
}

export type OpenCodePermissionConfig =
  | OpenCodePermissionAction
  | Partial<
      Record<
        OpenCodePermissionName,
        OpenCodePermissionAction | Record<string, OpenCodePermissionAction>
      >
    >
  | OpenCodePermissionRule[];

export interface OpenCodeRequestConfig {
  mode?: "sdk" | "cli";
  baseUrl?: string;
  sessionId?: string;
  agent?: string;
  directory?: string;
  permission?: OpenCodePermissionConfig;
  structuredOutputRetryCount?: number;
}

export interface OpenCodeOptions extends ProviderOptions {
  opencode?: OpenCodeRequestConfig;
}

export interface ChatOptions extends ProviderOptions {
  provider: ProviderName;
  metadata?: Record<string, unknown>;
  frequencyPenalty?: number;
  presencePenalty?: number;
  opencode?: OpenCodeRequestConfig;
}
```

Adapter signature:

```ts
export async function opencodeChat(
  options: OpenCodeOptions,
): Promise<AdapterResponse>;

export function isOpenCodeAvailable(): boolean;
```

Model parsing:

```ts
type ParsedOpenCodeModel =
  | { providerID: string; modelID: string }
  | null;

function parseOpenCodeModel(model: string | undefined): ParsedOpenCodeModel;
```

Rules:

- `undefined`, `""`, and `"default"` return `null`, meaning OpenCode uses its configured default model.
- A non-default model must be in OpenCode `provider/model` form.
- Invalid non-default model strings fail fast before calling OpenCode.

Permission helpers:

```ts
function defaultOpenCodePermission(): OpenCodePermissionConfig;

function normalizeOpenCodePermission(
  permission: OpenCodePermissionConfig,
): OpenCodePermissionRule[];
```

Rules:

- `defaultOpenCodePermission()` returns `{ "*": "deny" }`.
- SDK mode passes `normalizeOpenCodePermission(opencode.permission ?? defaultOpenCodePermission())` to `client.session.create`.
- CLI mode sets `OPENCODE_PERMISSION` to `JSON.stringify(opencode.permission ?? defaultOpenCodePermission())`.

### Design Decisions

- Keep POP as the orchestration owner. OpenCode runs a prompt; POP still owns task stages, artifacts, status files, gates, retries, and SSE.
- Prefer SDK/client-only server mode. OpenCode's SDK exposes structured output with JSON schema and client-only attachment to an existing server. The adapter should use `createOpencodeClient` from `@opencode-ai/sdk/v2` against `opencode.baseUrl`, `PO_OPENCODE_BASE_URL`, or `OPENCODE_BASE_URL` when configured.
- Do not use SDK helpers that start servers. `createOpencode` and `createOpencodeServer` start an OpenCode server, so this adapter must not call them.
- Support CLI mode as a fallback. CLI mode uses `opencode run --format json` with an explicit timeout and no implicit `opencode serve` startup.
- Do not start unmanaged long-running servers. This repository's operating rules require long-lived processes to be user/supervisor controlled.
- Safe-by-default permissions. OpenCode's documented defaults are permissive for most permissions, so POP must create SDK sessions or CLI subprocesses with an explicit deny-by-default permission config unless the caller explicitly provides `opencode.permission`.
- Do not duplicate OpenCode's model catalog. Add `opencode:default` only; callers can pass dynamic `model: "provider/model"` values through `llm.chat`.
- Keep static cost at zero for OpenCode. POP should still normalize token usage when available and estimate token counts when absent, but dynamic OpenCode pricing is out of scope for phase 1.

### Dependency Map

- `src/llm/index.ts` depends on `src/providers/opencode.ts` through `opencodeChat` and `isOpenCodeAvailable`.
- `src/providers/opencode.ts` depends on `@opencode-ai/sdk/v2`, Bun subprocess APIs, `src/providers/base.ts`, and `src/providers/types.ts`.
- `src/core/task-runner.ts` remains unchanged and receives the same `HighLevelLLM` interface.
- External runtime dependency: OpenCode CLI or an OpenCode server reachable through `OPENCODE_BASE_URL` / `PO_OPENCODE_BASE_URL`.

Reference facts checked from OpenCode docs and `@opencode-ai/sdk@1.17.4` package types:

- The SDK package is `@opencode-ai/sdk`; the typed v2 export supports client-only connection to an existing server through `createOpencodeClient`.
- SDK v2 `session.create` supports `body.permission`, SDK v2 `session.prompt` supports `body.format` with JSON-schema structured output, and assistant responses expose `info.structured` plus token metadata.
- CLI `opencode run --format json` emits raw JSON events, not a schema-enforced model output contract.
- CLI mode can receive inline permission config through the `OPENCODE_PERMISSION` environment variable.
- OpenCode permissions include `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `todowrite`, `webfetch`, `websearch`, `lsp`, `skill`, `question`, and `doom_loop` controls.

## 5. Acceptance Criteria

### Core Behavior

- AC-1: `ProviderName`, `ChatOptions`, and `ProviderAvailability` include `opencode`.
- AC-2: `chat({ provider: "opencode", ... })` dispatches to `opencodeChat` and returns the standard `ChatResponse` shape.
- AC-3: `createLLMWithOverride({ provider: "opencode", model: "anthropic/claude-sonnet-4-5" })` routes all model calls through OpenCode with that model.
- AC-4: `src/config/models.ts` contains exactly one OpenCode alias, `opencode:default`, with zero static input and output cost.
- AC-5: A dynamic OpenCode model string in `provider/model` form is accepted without adding it to `MODEL_CONFIG`.

### Response Handling

- AC-6: When `responseFormat` contains `json_schema`, SDK mode sends OpenCode a structured output format with `type: "json_schema"` and the supplied schema.
- AC-7: When OpenCode returns structured output, `opencodeChat` returns that object as `AdapterResponse.content`.
- AC-8: When OpenCode returns text in JSON mode without structured output, `opencodeChat` strips markdown fences, parses JSON, and returns the parsed object.
- AC-9: When OpenCode returns invalid JSON in JSON mode, `opencodeChat` throws `ProviderJsonParseError` with provider `opencode`.
- AC-10: When `responseFormat` is text mode, `opencodeChat` returns cleaned text as `content`.

### Safety And Process Handling

- AC-11: SDK mode attaches to an existing server when `opencode.baseUrl`, `PO_OPENCODE_BASE_URL`, or `OPENCODE_BASE_URL` is set and does not start `opencode serve`.
- AC-12: CLI mode runs `opencode run --format json` with `--model` only when a non-default model is supplied, passes deny-by-default permissions through `OPENCODE_PERMISSION` unless explicitly overridden, and kills the subprocess on timeout.
- AC-13: The default OpenCode permission config is `{ "*": "deny" }` unless explicitly overridden.
- AC-14: Availability checks are non-interactive and return `true` when `PO_OPENCODE_BASE_URL` or `OPENCODE_BASE_URL` is configured or `opencode --version` exits `0`; they return `false` when neither condition is true and must not run commands that prompt for auth.

### Observability And Integration

- AC-15: Successful OpenCode calls still emit `llm:request:complete` with provider `opencode`, the requested model string, normalized token counts, and numeric cost.
- AC-16: Failed OpenCode calls still emit `llm:request:error` with provider `opencode` and the error message.
- AC-17: Missing usage metadata falls back to POP's token estimation and does not crash status token usage serialization.
- AC-18: Local docs reference that the architectural decision is to keep POP orchestration and add OpenCode only as an optional prompt runner.

## 6. Notes

- Chosen approach: provider adapter. This keeps POP's deterministic orchestration and gives users OpenCode auth/model reach. It gives up immediate whole-agent task delegation.
- Rejected approach: replacing POP orchestration with OpenCode sessions. That would make tool side effects, resumability, gates, and artifact tracking harder to preserve.
- Rejected approach: importing all OpenCode models into `MODEL_CONFIG`. That recreates the model-catalog maintenance problem this feature is meant to reduce.
- SDK mode should be primary because OpenCode documents schema-backed structured output there. CLI mode remains useful for non-server environments but treats `--format json` as transport events only.
- Direct providers remain supported. Do not remove OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, Z.ai, Alibaba, or Claude Code in this spec.
- `getAvailableProviders()` is synchronous in this repository, so OpenCode availability treats configured `PO_OPENCODE_BASE_URL` / `OPENCODE_BASE_URL` as available without a live HTTP health check. Actual server connectivity failures surface through `opencodeChat`.
- No critique file exists for this spec folder at write time, so there is no critique reconciliation.

## 7. Implementation Steps

1. Add OpenCode provider types.

   What to do: Modify `src/providers/types.ts` to add `"opencode"` to `ProviderName`, add `opencode: boolean` to `ProviderAvailability`, add `OpenCodePermissionAction`, `OpenCodePermissionKey`, `OpenCodePermissionName`, `OpenCodePermissionRule`, `OpenCodePermissionConfig`, `OpenCodeRequestConfig`, and `OpenCodeOptions`, and add optional `opencode?: OpenCodeRequestConfig` to `ChatOptions`.

   Why: This establishes the public contract for calling OpenCode through the existing LLM gateway.

   Signatures/contracts: Use the types and interfaces from the Architecture section exactly.

   Tests: Add compile-time usage in `src/providers/__tests__/types.test.ts` that constructs a `ChatOptions` object with `provider: "opencode"` and nested `opencode` config.

   Covers: AC-1

2. Add the OpenCode model registry alias.

   What to do: Modify `src/config/models.ts` to add `opencode` to its provider type, add `ModelAlias.OPENCODE_DEFAULT = "opencode:default"`, add a `MODEL_CONFIG_RAW["opencode:default"]` entry with `provider: "opencode"`, `model: "default"`, and zero token costs, and add `opencode: "opencode:default"` to `DEFAULT_MODEL_BY_PROVIDER`.

   Why: POP needs one static alias for default routing without mirroring OpenCode's model catalog.

   Signatures/contracts: No new exported functions.

   Tests: Update `src/config/__tests__/models.test.ts` constants and provider list; add assertions that `getModelConfig("opencode:default")` returns zero pricing and that `MODEL_CONFIG` contains exactly one key with the `opencode:` prefix.

   Covers: AC-4

3. Add the SDK dependency.

   What to do: Add `@opencode-ai/sdk` to `package.json` dependencies and refresh `bun.lock` with `bun install`.

   Why: The primary OpenCode integration path uses the official JS/TS SDK.

   Signatures/contracts: N/A.

   Tests: No dedicated test. Existing TypeScript import/typecheck coverage exercises the dependency.

   Covers: Architecture dependency on `@opencode-ai/sdk/v2`

4. Add OpenCode model parsing.

   What to do: Create `src/providers/opencode.ts` with pure helper `parseOpenCodeModel`.

   Why: Dynamic OpenCode model routing must be accepted without adding every OpenCode model to POP's registry.

   Signatures/contracts: `parseOpenCodeModel(undefined | "" | "default")` returns `null`; valid `provider/model` strings return `{ providerID, modelID }`; invalid non-default strings throw `Error` before SDK or CLI work starts.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert default/null parsing, valid `provider/model` parsing, and invalid values such as `"anthropic"`, `"/model"`, `"provider/"`, and `"provider/model/extra"`.

   Covers: AC-5

5. Add OpenCode prompt and JSON-format helpers.

   What to do: In `src/providers/opencode.ts`, add pure helpers `buildOpenCodePromptText`, `isJsonMode`, and `jsonSchemaFromResponseFormat`.

   Why: SDK and CLI modes need one shared interpretation of POP messages and JSON response formats.

   Signatures/contracts: `jsonSchemaFromResponseFormat` returns the supplied `json_schema` object only when present; `isJsonMode` returns true for `"json"`, `"json_object"`, `{ type: "json_object" }`, or `{ json_schema: ... }`; prompt text preserves system, user, and assistant content in request order.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert prompt text includes all message roles in order, JSON mode detection, and schema extraction.

   Covers: Architecture response-format contract

6. Add OpenCode permission helpers.

   What to do: In `src/providers/opencode.ts`, add pure helpers `defaultOpenCodePermission` and `normalizeOpenCodePermission`.

   Why: POP's default OpenCode calls must be non-interactive and safe by default in both SDK and CLI modes.

   Signatures/contracts: `defaultOpenCodePermission()` returns `{ "*": "deny" }`; `normalizeOpenCodePermission` converts string, object, and ruleset forms into `OpenCodePermissionRule[]` with `{ permission, pattern, action }` entries suitable for SDK v2 session creation.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert the default config is exactly `{ "*": "deny" }`, normalizing it produces a deny rule, granular object syntax preserves patterns, explicit caller rules are preserved, and no normalized default rule uses `ask` or `allow`.

   Covers: AC-13

7. Add structured-output extraction.

   What to do: In `src/providers/opencode.ts`, add pure helper `extractOpenCodeStructuredOutput`.

   Why: SDK structured output should become POP adapter content without falling through to text parsing.

   Signatures/contracts: Structured output is read from SDK assistant metadata such as `info.structured`; missing structured output returns `undefined`.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert structured output extraction and missing structured output fallback.

   Covers: AC-7

8. Add text extraction.

   What to do: In `src/providers/opencode.ts`, add pure helper `extractOpenCodeText`.

   Why: SDK and CLI modes should share the same text accumulation before JSON parsing or text-mode return.

   Signatures/contracts: Text is accumulated from SDK text parts and CLI text events; unknown parts/events are ignored.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert text extraction from SDK parts, CLI text events, and unknown event tolerance.

   Covers: AC-10

9. Add OpenCode usage normalization.

   What to do: In `src/providers/opencode.ts`, add pure helper `normalizeOpenCodeUsage`.

   Why: POP should use OpenCode token metadata when available but fall back to gateway estimation when it is missing.

   Signatures/contracts: Usage maps OpenCode token metadata to `prompt_tokens`, `completion_tokens`, and `total_tokens` when available and returns `undefined` when unavailable.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert usage normalization from SDK metadata and `undefined` fallback when metadata is absent.

   Covers: AC-17

10. Implement SDK-mode session lifecycle.

   What to do: In `src/providers/opencode.ts`, implement the SDK path in `opencodeChat`. Resolve base URL from `opencode.baseUrl`, `PO_OPENCODE_BASE_URL`, then `OPENCODE_BASE_URL`. Use `createOpencodeClient` from `@opencode-ai/sdk/v2`; create a fresh session unless `opencode.sessionId` is supplied; pass `directory` through SDK query options; create new sessions with normalized default or caller-provided permissions; pass parsed model only when non-default; pass `agent` when supplied; and respect `requestTimeoutMs` with abort/cancellation.

   Why: SDK mode is the primary path for server-backed OpenCode usage while preserving repo rules against unmanaged servers.

   Signatures/contracts: `opencodeChat(options: OpenCodeOptions): Promise<AdapterResponse>`.

   Tests: Mock `@opencode-ai/sdk/v2` in `src/providers/__tests__/opencode.test.ts`; assert client-only base URL is used, a fresh session is created by default, `sessionId` reuses an explicit session, permission rules are applied to new sessions, model/agent/directory are forwarded, request timeout cancellation is wired, and `createOpencode` / `createOpencodeServer` are never called.

   Covers: AC-11

11. Implement SDK JSON-schema request mapping.

   What to do: In the SDK path in `opencodeChat`, pass `format: { type: "json_schema", schema, retryCount }` to `client.session.prompt` when `responseFormat.json_schema` exists, using `opencode.structuredOutputRetryCount` when supplied and OpenCode's default when omitted.

   Why: POP JSON-schema callers should get OpenCode's schema-backed structured output rather than a plain text prompt convention.

   Signatures/contracts: `retryCount` is omitted when `structuredOutputRetryCount` is `undefined`.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert schema response format maps to OpenCode format and retry count is forwarded only when supplied.

   Covers: AC-6

12. Return SDK structured output as content.

   What to do: In `opencodeChat`, after SDK mode receives a response, return SDK structured output as `AdapterResponse.content` when present.

   Why: Schema-backed OpenCode output should be trusted over any text fallback.

   Signatures/contracts: Structured output wins over text parsing; raw SDK response is preserved.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert structured output becomes `content` and raw SDK response is preserved.

   Covers: AC-7

13. Parse JSON text responses.

   What to do: In `opencodeChat`, when SDK or CLI returns text in JSON mode without structured output, strip markdown fences, parse the text with `tryParseJSON`, and return the parsed object as `AdapterResponse.content`.

   Why: POP tasks rely on consistent provider behavior across all backends.

   Signatures/contracts: Return `AdapterResponse` with parsed `content`, cleaned `text`, `usage`, and `raw`.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert fenced JSON and plain JSON parse successfully.

   Covers: AC-8

14. Throw OpenCode JSON parse errors.

   What to do: In `opencodeChat`, when JSON mode text parsing fails, throw `ProviderJsonParseError("opencode", model, sample)`.

   Why: Invalid JSON must fail with the same provider-specific error type as other POP adapters.

   Signatures/contracts: The `provider` property is `opencode`, `model` is the requested model string or `"default"`, and `sample` is taken from the cleaned text.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert invalid JSON throws `ProviderJsonParseError` with provider `opencode` and the requested model.

   Covers: AC-9

15. Return text-mode responses.

   What to do: In `opencodeChat`, when `responseFormat` is text mode, strip markdown fences and return cleaned text as `AdapterResponse.content`.

   Why: Non-JSON callers should receive the standard text-mode provider behavior.

   Signatures/contracts: Return `AdapterResponse` with string `content`, cleaned `text`, `usage`, and `raw`.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert text mode returns a string and preserves raw response data.

   Covers: AC-10

16. Implement CLI-mode fallback.

   What to do: In `src/providers/opencode.ts`, add CLI execution for `opencode.mode === "cli"` or when no base URL is configured and CLI is available. Spawn `opencode run --format json`, include `--model <provider/model>` only for non-default models, include `--agent`, `--dir`, `--session`, and `--attach` only when explicitly supplied, set `OPENCODE_PERMISSION` to caller-provided permissions or `defaultOpenCodePermission()`, read newline-delimited JSON events, accumulate text parts, preserve raw events, and kill the process on `requestTimeoutMs`.

   Why: Users can run prompts through OpenCode without a prestarted server while keeping execution bounded and non-interactive.

   Signatures/contracts: The CLI parser should accept events with `{ type: "text", part: { text } }` and ignore unknown event types.

   Tests: In `src/providers/__tests__/opencode.test.ts`, mock `Bun.spawn`; assert command arguments, `OPENCODE_PERMISSION`, accumulated text, non-zero exit error message, malformed event tolerance, and timeout kill behavior.

   Covers: AC-12

17. Implement availability checks.

   What to do: Add `isOpenCodeAvailable()` in `src/providers/opencode.ts`. It returns true when `PO_OPENCODE_BASE_URL` or `OPENCODE_BASE_URL` is set, or when `Bun.spawnSync(["opencode", "--version"], { timeout: 5000 })` exits `0`; otherwise false. Do not call commands that prompt for auth.

   Why: `getAvailableProviders()` is synchronous and must stay non-interactive for UI/status usage.

   Signatures/contracts: `export function isOpenCodeAvailable(): boolean`.

   Tests: In `src/providers/__tests__/opencode.test.ts`, mock `Bun.spawnSync` and env vars; assert true on configured base URL, true on CLI success, false on CLI failure/throw, and no interactive command arguments.

   Covers: AC-14

18. Wire OpenCode chat dispatch into the LLM gateway.

   What to do: Modify `src/llm/index.ts` to import `opencodeChat`, dispatch `case "opencode"` in `callAdapter`, include `opencode: options.opencode` when calling the adapter, and preserve the existing request timeout behavior.

   Why: This exposes OpenCode through existing `llm.chat`.

   Signatures/contracts: No new top-level LLM functions.

   Tests: In `src/llm/__tests__/index.test.ts`, mock or register the OpenCode adapter path and assert `chat({ provider: "opencode" })` returns a standard response.

   Covers: AC-2

19. Wire OpenCode model override.

   What to do: Ensure the model map from `opencode:default` exposes callable OpenCode model functions without disrupting existing `claudecode` / `claude-code` and `zai` / `zhipu` aliases.

   Why: High-level LLM callers should be able to force OpenCode as the backend for any model string.

   Signatures/contracts: `createLLMWithOverride({ provider: "opencode", model })` must route grouped model calls and direct `chat` calls through OpenCode with the override model.

   Tests: In `src/llm/__tests__/index.test.ts`, assert `createLLM()` exposes the OpenCode default alias and `createLLMWithOverride` routes provider/model to OpenCode.

   Covers: AC-3

20. Wire OpenCode provider availability into the gateway.

   What to do: Modify `src/llm/index.ts` to import `isOpenCodeAvailable` and add `opencode: isOpenCodeAvailable()` in `getAvailableProviders()`.

   Why: Status views should report OpenCode consistently with other providers.

   Signatures/contracts: `getAvailableProviders()` remains synchronous.

   Tests: In `src/llm/__tests__/index.test.ts`, assert `getAvailableProviders()` includes `opencode` and reflects mocked OpenCode availability.

   Covers: AC-14

21. Preserve OpenCode complete telemetry and zero dynamic cost.

   What to do: In `src/llm/index.ts`, keep the existing `llm:request:complete` emission path for OpenCode and ensure `calculateCost("opencode", dynamicModel, usage)` returns `0`.

   Why: OpenCode must not break POP metrics or cost reporting when dynamic model pricing is unknown.

   Signatures/contracts: Complete events include provider `opencode`, requested model string, normalized token counts, and numeric cost.

   Tests: In `src/llm/__tests__/index.test.ts`, assert successful OpenCode calls emit `llm:request:complete` with provider `opencode`, requested model, numeric token counts, and cost `0` for dynamic OpenCode models.

   Covers: AC-15

22. Preserve OpenCode error telemetry.

   What to do: In `src/llm/index.ts`, keep the existing `llm:request:error` emission path for OpenCode adapter failures.

   Why: Failed OpenCode calls should remain observable through POP's existing metrics surface.

   Signatures/contracts: Error events include provider `opencode` and the thrown error message.

   Tests: In `src/llm/__tests__/index.test.ts`, assert failed OpenCode calls emit `llm:request:error` with provider `opencode` and the error message.

   Covers: AC-16

23. Preserve OpenCode usage fallback.

   What to do: In `src/llm/index.ts`, rely on adapter usage when present and on token estimation when adapter usage is absent.

   Why: OpenCode responses without usage metadata must not crash status token usage serialization.

   Signatures/contracts: Missing adapter usage still produces numeric `promptTokens`, `completionTokens`, and `totalTokens`.

   Tests: In `src/llm/__tests__/index.test.ts`, assert missing OpenCode adapter usage produces estimated token counts.

   Covers: AC-17

24. Update local decision references.

   What to do: Ensure `docs/current-architecture.md` and `docs/provider-requirements.md` reference `.specs/299-opencode-backend-layer/spec.md` and state that OpenCode is an optional prompt runner under POP's LLM provider layer, not a replacement for POP orchestration.

   Why: Future contributors should discover the decision from local architecture/provider docs before changing the design.

   Signatures/contracts: N/A.

   Tests: No automated test required; this is a local decision reference tied to AC-18.

   Covers: AC-18

## 8. Applicable Rules

- `/Users/ryanmahoney/.agents/rules/unit-testing.md` - spec adds provider and gateway unit tests.

Spec folder: .specs/299-opencode-backend-layer/
