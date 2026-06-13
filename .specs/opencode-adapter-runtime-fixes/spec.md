# Implementation Spec: OpenCode Adapter Runtime Correctness Fixes

## 1. Qualifications

- TypeScript provider adapter maintenance
- `@opencode-ai/sdk` v2 typed client (`session.create`, `session.prompt`, `session.delete`)
- `AbortController` / fetch-style request cancellation
- Resource lifecycle and `finally`-based cleanup
- Vitest unit testing with module mocks and typed fixtures

## 2. Problem Statement

The `opencode` provider adapter in `src/providers/opencode.ts` passes its mock-based test suite but contains three defects against the installed `@opencode-ai/sdk@1.17.4` typed surface: token usage is read from flat fields (`info.prompt_tokens` / `info.input_tokens`) that the SDK never emits — the real shape is nested `info.tokens.{input,output}` — so usage is always dropped and silently estimated; the SDK request's abort `signal` is placed in the `session.prompt` parameters object instead of its options argument, so `requestTimeoutMs` never cancels a hung call; and a session is created per call and never deleted, leaking sessions on a long-lived OpenCode server. This spec fixes all three and corrects the tests that certify the broken shapes.

## 3. Goal

Make the OpenCode SDK path report measured token usage, enforce its request timeout, and delete every session it creates — verified by tests whose fixtures match the real SDK types.

## 4. Architecture

### Files To Modify

- `src/providers/opencode.ts`
  - Rewrite `normalizeOpenCodeUsage` to read the nested `info.tokens` shape.
  - Add internal `deleteOpenCodeSession(client, sessionID, timeoutMs?)` — a bounded, error-swallowing cleanup helper.
  - Restructure the SDK path of `opencodeChat`: hoist the client above the retry loop, track which session the adapter created, move the abort `signal` into the `session.prompt` options argument, and delete the created session in a `finally` that brackets the whole retry loop.
- `src/providers/__tests__/opencode.test.ts`
  - Replace the invented flat-token fixtures with fixtures typed against the SDK `AssistantMessage`.
  - Add assertions for measured usage, signal placement, timeout rejection, created-vs-supplied session cleanup, bounded cleanup, and one-create/one-delete across a retried call.
- `src/llm/__tests__/index.test.ts`
  - Strengthen the OpenCode `llm:request:complete` assertion to verify measured (non-estimated) token counts when the adapter returns usage.

No changes to `src/llm/index.ts` dispatch, `src/providers/types.ts`, `src/config/models.ts`, permission defaults, availability checks, or docs.

### Key Contracts

```ts
// Pure: real nested SDK token shape (AssistantMessage.tokens)
export function normalizeOpenCodeUsage(raw: unknown): AdapterUsage | undefined;

// Internal IO helper — bounded cleanup; never throws.
const SESSION_DELETE_TIMEOUT_MS = 5000;
async function deleteOpenCodeSession(
  client: OpencodeClient,
  sessionID: string,
  timeoutMs?: number, // default SESSION_DELETE_TIMEOUT_MS
): Promise<void>;

// Public signature unchanged.
export async function opencodeChat(
  options: OpenCodeOptions,
): Promise<AdapterResponse>;
```

`normalizeOpenCodeUsage` rules (real shape, from `@opencode-ai/sdk/v2` `AssistantMessage`):

- Read `info = raw.info` (object) and `tokens = info.tokens` (object).
- `prompt_tokens = tokens.input`, `completion_tokens = tokens.output` (both must be numbers).
- `total_tokens = tokens.total` when numeric, else `tokens.input + tokens.output`.
- Return `undefined` when `info`, `tokens`, or `input`/`output` are missing or non-numeric (preserving gateway estimation fallback).

`session.prompt` / `session.delete` call shape (verified against `dist/v2/gen/sdk.gen.d.ts`):

```ts
client.session.prompt(promptParams, { signal: controller.signal });
client.session.delete({ sessionID }, { signal: deleteController.signal });
```

`opencodeChat` SDK-path control flow:

```text
resolve baseUrl, mode, parsedModel, schema
if mode === "sdk":
  if baseUrl == null -> throw (fail fast, before loop)
  client = createOpencodeClient({ baseUrl })          // hoisted, created once
  callerSessionId = opencode.sessionId
  sdkSessionID = callerSessionId
  createdSessionId = undefined
  try:
    for attempt in 0..maxRetries:
      try:
        if !sdkSessionID:
          create session with normalized permission/model/agent
          sdkSessionID = createResult.data.id
          createdSessionId = sdkSessionID             // adapter owns it
        result = await client.session.prompt(promptParams, { signal })
        ... extract content/text/usage ...
        return AdapterResponse
      catch err:
        lastError = err
        if !isRetryableError(err) || attempt >= maxRetries: throw err
        await sleep(backoff)
    throw lastError
  finally:
    if createdSessionId != null:
      await deleteOpenCodeSession(client, createdSessionId)   // bounded, swallows errors
```

### Design Decisions

- **Delete-after-use, not pooling.** Preserves the phase-1 "fresh session per request" repeatability guarantee. Session-creation churn cost is accepted (see Notes).
- **Cleanup is bounded and silent.** `deleteOpenCodeSession` carries its own `AbortController` timeout and swallows all errors, so a down server cannot turn cleanup into a second hang and cleanup failures never mask the primary result or error. This addresses the critique's top must-fix.
- **Only adapter-created sessions are deleted.** A caller-supplied `opencode.sessionId` is never deleted — the adapter does not own it.
- **Session lifecycle brackets the whole retry loop.** Creation happens once (retries reuse `sdkSessionID`); cleanup runs once in the outer `finally`. A retry must not delete a session it still needs.
- **Drop the `as unknown` casts on the prompt call.** Typing `promptParams` and the options argument against the real SDK types makes a future signature change a compile error rather than a silent regression.
- **Typed fixtures.** SDK response fixtures in tests are typed against `import("@opencode-ai/sdk/v2").AssistantMessage` so a shape drift fails compilation — the original bug was a mock asserting a shape the SDK never emits.

### Dependency Map

- `src/providers/opencode.ts` depends on `@opencode-ai/sdk/v2` (`createOpencodeClient`, `OpencodeClient`, `AssistantMessage`), `AbortController`, `src/providers/base.ts`, `src/providers/types.ts`.
- No new external dependency; `session.delete` is on the existing typed client.
- `src/llm/index.ts` is unchanged and continues to emit `llm:request:complete` / `llm:request:error` and estimate usage only when the adapter returns none.

## 5. Acceptance Criteria

### Usage Normalization

- AC-1: `normalizeOpenCodeUsage({ info: { tokens: { input, output } } })` returns `{ prompt_tokens: input, completion_tokens: output, total_tokens: input + output }`.
- AC-2: When `info.tokens.total` is a number, `total_tokens` equals it rather than `input + output`.
- AC-3: `normalizeOpenCodeUsage` returns `undefined` when `info`, `info.tokens`, `tokens.input`, or `tokens.output` is missing or non-numeric.
- AC-4: A real-shaped SDK prompt response (`info.tokens.{input,output}`) produces `AdapterResponse.usage` with those measured counts, and the gateway `llm:request:complete` event carries the measured counts (not char/4 estimates).

### Timeout / Cancellation

- AC-5: `client.session.prompt` is called with the abort signal in its second (options) argument; the parameters argument contains no `signal`.
- AC-6: When the SDK prompt does not settle within `requestTimeoutMs`, the controller aborts and `opencodeChat` rejects (so the gateway emits `llm:request:error`).

### Session Lifecycle

- AC-7: When no `opencode.sessionId` is supplied, the adapter calls `session.delete` for the session it created after a successful prompt.
- AC-8: When no `opencode.sessionId` is supplied and the prompt throws a non-retryable error, the adapter still calls `session.delete` for the created session.
- AC-9: When `opencode.sessionId` is supplied, the adapter never calls `session.delete`.
- AC-10: `deleteOpenCodeSession` is bounded by its own timeout and its failure does not propagate — the original prompt result or error is preserved.
- AC-11: Across a retried call (one retryable failure then success), `session.create` is called exactly once and `session.delete` is called exactly once.

### Test Fidelity

- AC-12: SDK response fixtures used by the tests are typed against the SDK `AssistantMessage`, so a change to the `tokens`/`structured`/`parts` shape breaks compilation.

## 6. Notes

- **Deferred — usage provenance across providers (critique "Should Address").** The critique recommends marking each `llm:request:complete` as measured vs. estimated. That is a gateway-level change to `normalizeUsage` / `NormalizedUsage` in `src/llm/index.ts` affecting every provider, not just OpenCode. It is deferred to a separate change to keep this spec a focused adapter correctness fix; recorded here as a known follow-up.
- **Deferred — circuit breaker / bulkhead (critique divergence).** POP is a single-node, file-based orchestrator with bounded `parallel()` concurrency attaching to a user-managed `opencode serve`; a full circuit breaker is over-engineering for phase 1. The cheap half of the hardening (bounded cleanup timeout) is included; the heavyweight half is declined.
- **Known limit — slot exhaustion under a slow server (critique "Consider").** With the timeout fixed, prompts against a degraded OpenCode server still occupy `parallel()` slots for up to `requestTimeoutMs` each before failing. No code change; documented as an operating boundary.
- **Untested assumption — session churn cost (critique "Consider").** Delete-after-use adds a create+delete round-trip per call. The cost is assumed acceptable; a one-time measurement against a real server would confirm before any future move to pooling.
- **Risk — control-flow restructure.** Bracketing session lifecycle around the retry loop is the riskiest part of the diff (more than a one-line fix). AC-11 exists specifically to pin the one-create/one-delete invariant.
- **Trade-off summary.** Chosen: fix the three defects in place with delete-after-use and bounded cleanup. Gives up: shared session reuse and gateway-wide usage provenance. Gains: accurate OpenCode telemetry, an enforced timeout, and no session leak, with minimal blast radius. Alternatives considered: pooled session (rejected — breaks repeatability), CLI usage mapping (rejected — transport events, not a stable usage contract).

## 7. Implementation Steps

1. Rewrite `normalizeOpenCodeUsage` for the nested token shape.

   What to do: In `src/providers/opencode.ts`, replace the flat-field reads with `info.tokens.input` / `info.tokens.output`, computing `total_tokens` from `info.tokens.total` when numeric else `input + output`, and returning `undefined` when `info`, `tokens`, `input`, or `output` is missing or non-numeric.

   Why: The SDK `AssistantMessage` exposes nested `tokens`; the old flat reads never match, so usage was always dropped.

   Signatures/contracts: `normalizeOpenCodeUsage(raw: unknown): AdapterUsage | undefined` (unchanged signature).

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert mapping from `{ info: { tokens: { input, output } } }`, `total` override, and `undefined` for missing `info` / missing `tokens` / missing `output`.

   Covers: AC-1, AC-2, AC-3

2. Add the bounded `deleteOpenCodeSession` cleanup helper.

   What to do: In `src/providers/opencode.ts`, add `const SESSION_DELETE_TIMEOUT_MS = 5000` and an internal `async function deleteOpenCodeSession(client, sessionID, timeoutMs = SESSION_DELETE_TIMEOUT_MS)` that calls `client.session.delete({ sessionID }, { signal })` under its own `AbortController` timeout, clears the timer in `finally`, and swallows all errors.

   Why: An unbounded delete in `finally` would reintroduce the hang on a down server; cleanup failures must never mask the primary result/error.

   Signatures/contracts: `deleteOpenCodeSession(client: OpencodeClient, sessionID: string, timeoutMs?: number): Promise<void>` — never throws.

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert a rejecting `session.delete` does not cause `opencodeChat` to reject, and that the delete call receives a signal in its options argument.

   Covers: AC-10

3. Restructure the SDK path of `opencodeChat`.

   What to do: In `src/providers/opencode.ts`, for `mode === "sdk"`: throw the missing-base-URL error before the retry loop; create the client once above the loop; track `createdSessionId` (set only when the adapter creates a session, i.e. no `opencode.sessionId`); pass the abort signal as the second argument to `client.session.prompt(promptParams, { signal })` with no `signal` in `promptParams`; remove the `as unknown` casts by typing against the SDK; and wrap the retry loop in `try { ... } finally { if (createdSessionId != null) await deleteOpenCodeSession(client, createdSessionId); }`.

   Why: Enforces `requestTimeoutMs`, deletes only adapter-created sessions exactly once, and keeps cleanup outside the retry loop so a retry cannot delete a session it still needs.

   Signatures/contracts: `opencodeChat(options: OpenCodeOptions): Promise<AdapterResponse>` (unchanged).

   Tests: In `src/providers/__tests__/opencode.test.ts`, assert: prompt receives the signal in its options argument and parameters carry no signal; a never-settling prompt rejects after `requestTimeoutMs`; created-session success and created-session throw both trigger one `session.delete`; a supplied `opencode.sessionId` triggers no `session.delete`; one retryable failure then success yields exactly one `create` and one `delete`. In `src/llm/__tests__/index.test.ts`, assert a successful OpenCode call with real-shaped usage emits `llm:request:complete` with the measured token counts.

   Covers: AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11

4. Type the SDK test fixtures against the real SDK shape.

   What to do: In `src/providers/__tests__/opencode.test.ts`, define the shared SDK prompt-response fixture (`info` with nested `tokens`, optional `structured`; `parts` with text) as a value typed `import("@opencode-ai/sdk/v2").AssistantMessage` (info) and the prompt result `{ info, parts }`, and remove the invented flat-token fixtures.

   Why: The original bug was a mock asserting a shape the SDK never emits; typing the fixture makes a future shape drift a compile error.

   Signatures/contracts: N/A (test-only).

   Tests: The fixture itself is the assertion — it must compile against the SDK type; existing structured-output and text-extraction tests reuse it unchanged.

   Covers: AC-12

## 8. Applicable Rules

- `~/.agents/rules/unit-testing.md` — every step adds or revises unit tests; mocks must restore cleanly and fixtures must match the real contract.

Spec folder: .specs/opencode-adapter-runtime-fixes/
