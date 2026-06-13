# Implementation Proposal: OpenCode Adapter Runtime Correctness Fixes

## Problem Restatement

The `opencode` provider adapter added in `.specs/299-opencode-backend-layer/` passes its mock-based test suite but contains three runtime defects that only surface against a real OpenCode server/SDK. The defects were found by diffing the adapter's assumptions against the installed `@opencode-ai/sdk@1.17.4` typed surface (`node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`). Each defect is invisible in CI because the tests mock `@opencode-ai/sdk/v2` and, in one case, assert a response shape the SDK never emits.

The trigger is normal POP execution: a pipeline inference stage calls `context.llm.chat({ provider: "opencode", ... })`, which dispatches to `opencodeChat` in `src/providers/opencode.ts`. The expected changes are confined to the adapter, its unit tests, and possibly the shared options type.

Assumption: this proposal preserves the phase-1 design decision (OpenCode is an optional prompt runner under POP's existing provider contract, not a replacement orchestrator). It does not expand the integration's surface area; it makes the existing surface correct.

## Summary

Fix three defects in `src/providers/opencode.ts` and correct the tests that conceal them:

1. **Token usage is never captured from real responses.** `normalizeOpenCodeUsage` reads flat `info.prompt_tokens` / `info.input_tokens` / `info.completion_tokens` / `info.output_tokens`. The real SDK shape is nested: `AssistantMessage.tokens = { input, output, reasoning, total?, cache: { read, write } }`. The flat fields never exist, so usage is always `undefined` and the gateway silently falls back to char/4 estimation for every OpenCode call. Cost telemetry (`llm:request:complete`) is therefore always estimated, never sourced.

2. **SDK-mode request timeout does not cancel.** The `AbortController` signal is spread into the `session.prompt` *parameters* object and passed as the single first argument. The hey-api SDK signature is `prompt(parameters, options?)`; `signal` belongs in the second `options` argument. As written, the timer fires `controller.abort()` but the request ignores it, so `requestTimeoutMs` is not enforced in SDK mode. A hung server connection blocks the worker indefinitely.

3. **Sessions are created per call and never cleaned up.** Each call without an explicit `opencode.sessionId` creates a fresh server session via `client.session.create` and never deletes it. Under POP's normal multi-stage, multi-task workload this leaks sessions on a long-lived OpenCode server without bound.

A fourth, lower-priority item is noted as optional scope: the provider-specific `opencode?: OpenCodeRequestConfig` field lives on the shared `ChatOptions` type rather than in a provider-local options type, which is the one part of the integration that does not extend cleanly.

## Verdict: COMPATIBLE

These are bug fixes inside an already-accepted provider boundary. They do not change POP's orchestration, the provider dispatch contract, the `AdapterResponse` shape, the permission defaults, or the model-registry decision. Defects 1–3 are independently correct-by-construction once aligned to the real SDK types, and each has a direct, type-checkable fix.

## Critique Recommended: YES

Although the changes are small, two of them touch externally observable behavior (cost/telemetry accuracy and request cancellation), and the session-cleanup fix introduces a new SDK call (`session.delete`) whose failure modes and ownership semantics deserve a second perspective. A critique is warranted to confirm the cleanup approach (delete-after-use vs. pooled session) and the usage-field mapping are the right long-term shapes.

## Why Do This?

### Cost and token telemetry are currently wrong, not merely imprecise

`src/core/task-runner.ts` records token tuples from `llm:request:complete`, and operators read those to understand spend. Today every OpenCode call reports estimated tokens (length / 4) even when the server returned exact counts. This is a silent correctness regression: the numbers look populated but never reflect reality. Fixing the field mapping restores accurate accounting for the one provider where it is currently broken.

### An unenforced timeout is a liveness hazard

POP runs inference inside bounded task stages and fans out with `parallel()`. A `requestTimeoutMs` that does not actually cancel means one stuck OpenCode connection holds a concurrency slot forever, degrading the whole pipeline. Correct cancellation is the difference between a failed task and a wedged runner.

### Session leaks degrade a shared backend over time

The phase-1 design deliberately attaches to a user/supervisor-managed `opencode serve`. That server is long-lived and shared. Creating a session per prompt with no cleanup means a busy POP instance accumulates sessions indefinitely, consuming server memory and listing surface. Deleting sessions the adapter created keeps POP a well-behaved client.

### The tests currently certify a fiction

The `normalizeOpenCodeUsage` unit test feeds `{ info: { prompt_tokens, completion_tokens, total_tokens } }` — a shape the SDK never returns — and asserts it round-trips. The full-prompt mock right beside it uses the real `tokens: { input, output, ... }` shape but does not assert on counts. So the suite simultaneously demonstrates and hides the bug. Correcting the fixtures makes the tests defend real behavior.

## Why Not Do This? (Risks of the change itself)

### Risk: `session.delete` failure could mask the real error

If a prompt fails and the cleanup delete also fails, naive code could throw the cleanup error and lose the original. Mitigation: run cleanup in a `finally`, swallow/log cleanup errors, and always surface the original error.

### Risk: deleting a session the caller wanted to reuse

When the caller supplies `opencode.sessionId`, POP did not create that session and must not delete it. Mitigation: only delete sessions created inside this `opencodeChat` invocation; never delete a caller-supplied session.

### Risk: SDK option placement is version-sensitive

Moving `signal` into the second argument depends on the hey-api `Options` contract. Mitigation: type the call against the real `Options<never, false>` parameter rather than `as unknown` casts, so a future SDK signature change is a compile error, not a silent regression.

### Risk: usage shape could vary by SDK version

`tokens` is nested today; a future SDK could rename it. Mitigation: map defensively (read `info.tokens` as an optional object; fall back to estimation when absent — the existing behavior) and pin a tested minimum SDK version in docs.

## Affected Areas

- `src/providers/opencode.ts` - Fix `normalizeOpenCodeUsage` field mapping; move the abort `signal` into the SDK `options` argument; add created-session cleanup in a `finally`.
- `src/providers/__tests__/opencode.test.ts` - Replace the invented flat-token fixture with the real nested `tokens` shape; add a test asserting real token counts flow through to `AdapterResponse.usage`; add a test asserting `session.delete` is called for adapter-created sessions and not for caller-supplied `sessionId`; add a test asserting the prompt request carries an abort signal in the options position and that a timeout aborts.
- `src/llm/__tests__/index.test.ts` - Strengthen the OpenCode `llm:request:complete` assertion to verify non-estimated token counts when the adapter returns usage.
- `src/providers/types.ts` - Optional scope only: introduce `OpenCodeOptions`-local carriage of `opencode` config and deprecate the field on shared `ChatOptions`. Default recommendation is to leave this for a follow-up to keep blast radius minimal.

No changes to `src/llm/index.ts` dispatch, `src/config/models.ts`, permission defaults, availability checks, or docs are required.

## Implementation Steps

### 1. Correct token usage normalization

Rewrite `normalizeOpenCodeUsage(raw)` to read the real nested shape:

- Read `info = raw.info` (object guard as today).
- Read `tokens = info.tokens` (object guard).
- Map `prompt_tokens = tokens.input`, `completion_tokens = tokens.output`.
- Map `total_tokens = tokens.total` when numeric, else `tokens.input + tokens.output`.
- Return `undefined` when `info`, `tokens`, or the input/output numbers are absent (preserving the existing estimation fallback).

Keep the existing `AdapterUsage` (snake_case) return contract so the gateway's `normalizeUsage` is unchanged.

### 2. Place the abort signal correctly in SDK mode

Change the `client.session.prompt` call from a single merged argument to the two-argument form:

- First argument: `promptParams` (sessionID, parts, directory, model, agent, format) — no `signal`.
- Second argument: `{ signal: controller.signal }` typed as the SDK's `Options<never, false>`.

Remove the `as unknown as Parameters<...>` cast so the placement is type-checked. Verify against `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts` that `prompt(parameters, options?)` accepts `signal` in `options`.

### 3. Clean up adapter-created sessions

- Track whether this invocation created the session (`createdSessionId`) versus reused a caller-supplied `opencode.sessionId`.
- After the prompt resolves or throws, in a `finally`, if `createdSessionId` is set, call `client.session.delete({ sessionID: createdSessionId })`.
- Wrap cleanup in try/catch; log and swallow cleanup failures so the original result or error is preserved.
- Interaction with retries: the session is created inside the retry loop only on the first attempt (the current code reuses `sdkSessionID` across attempts). Ensure cleanup runs once, after the retry loop terminates, not per attempt — otherwise a retry would delete the session it still needs. Restructure so session creation/cleanup brackets the whole attempt loop for a given invocation.

### 4. Fix the tests to defend real behavior

- Replace the `normalizeOpenCodeUsage` fixture with `{ info: { tokens: { input, output, total, reasoning, cache } } }` and assert the mapped `{ prompt_tokens, completion_tokens, total_tokens }`.
- Add a negative test: `{ info: { tokens: { input } } }` (no output) returns `undefined`.
- Add a roundtrip assertion that a real-shaped prompt response yields `result.usage.prompt_tokens === tokens.input` (not an estimate).
- Add a cleanup test: adapter-created session triggers `session.delete`; caller-supplied `sessionId` does not.
- Add a cancellation test: the second argument to `session.prompt` carries a `signal`, and a forced timeout rejects without hanging.

### 5. (Optional, defer) Move provider-specific config off shared ChatOptions

If approved as in-scope, carry `opencode` config through `OpenCodeOptions` only and remove `opencode?` from `ChatOptions`, updating `callAdapter` to thread it explicitly. Default recommendation: defer to a separate change to keep this proposal a focused correctness fix.

## Data Changes

No schema or file-format migration. The only observable data change is that `tasks-status.json` token-usage entries for OpenCode calls will reflect real counts instead of estimates once usage normalization is fixed. Cost remains `0` for dynamic OpenCode models per the phase-1 decision.

## New Dependencies

None. All fixes use the already-installed `@opencode-ai/sdk@1.17.4`. `session.delete` is part of the existing typed client surface.

## Testing Strategy

Continue mocking `@opencode-ai/sdk/v2` as the suite does today, but make fixtures conform to the real generated types:

- Source fixtures from `AssistantMessage` (nested `tokens`, `structured`, `parts`) so a mock that compiles against the real shape cannot drift from reality.
- Assert exact token counts, not just presence, to lock the field mapping.
- Assert the `session.prompt` call's second argument carries the abort signal.
- Assert `session.delete` invocation count and argument for created vs. supplied sessions.
- Keep the existing structured-output, text-extraction, JSON-parse-error, CLI, and availability tests unchanged — those already match the real SDK shapes and pass for the right reasons.

Add no real-network test; a documented manual smoke check against an authenticated `opencode serve` remains the integration path.

## Edge Cases & Risks

### Edge: response with `structured` output but no `tokens`

Structured output extraction is independent of usage. Usage returns `undefined`; estimation fills in. No crash. Covered by an explicit test.

### Edge: caller-supplied session plus a thrown prompt

Cleanup must not delete the caller's session even on error. Covered by the supplied-session test.

### Edge: retry after a transient error

Session creation happens once; retries reuse it; cleanup happens once after the loop. A test that forces one retryable failure then success should assert exactly one `create` and one `delete`.

### Edge: CLI mode

CLI mode has no session lifecycle and already routes usage through estimation (no `info`). These fixes are SDK-mode-scoped; CLI behavior is unchanged.

### Risk: hidden reliance on the broken estimate

If any downstream code was implicitly tuned to the char/4 estimate, real counts will differ. This is the desired correction, but worth calling out in the change description.

## Alternative Approaches

### Alternative A: Fix all three defects in the adapter (recommended)

Smallest blast radius, no new dependencies, restores correctness for usage, timeout, and session lifecycle in one focused change.

Tradeoff: leaves the shared-`ChatOptions` smell for later.

### Alternative B: Pooled/reused session instead of delete-after-use

Maintain one long-lived POP-owned session per server and reuse it across calls, trading session-creation overhead for shared conversational state.

Tradeoff: breaks the phase-1 "fresh session per request" repeatability guarantee and risks context bleed between unrelated POP tasks. Rejected for now; revisit only if session-creation latency proves material.

### Alternative C: Map usage from CLI/event metadata too

Extend usage normalization to also read token metadata from CLI `--format json` events.

Tradeoff: CLI is the fallback path and emits transport events, not a stable usage contract. Out of scope; estimation remains acceptable for CLI mode.

## Recommendation

Proceed with Alternative A. Fix usage field mapping, abort-signal placement, and created-session cleanup in `src/providers/opencode.ts`; correct the fixtures and assertions that currently certify the broken shapes. Defer the shared-`ChatOptions` refactor and any session-pooling to separate follow-ups so this change stays a tightly scoped, verifiable correctness fix.
