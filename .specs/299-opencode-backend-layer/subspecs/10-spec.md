# Steps 10–17: `opencodeChat` and `isOpenCodeAvailable`

## Scope

Implement `opencodeChat(options): Promise<AdapterResponse>` and `isOpenCodeAvailable(): boolean` in `src/providers/opencode.ts`. These are the only two new exports. All existing pure helpers (steps 4–9) remain unchanged.

## Files modified

- `src/providers/opencode.ts` — added `opencodeChat`, `isOpenCodeAvailable`, and internal helpers
- `src/providers/__tests__/opencode.test.ts` — added test blocks for steps 10–17

## What changed

### `src/providers/opencode.ts`

**New imports:**
- `createOpencodeClient` from `@opencode-ai/sdk/v2` (runtime)
- `OpencodeClient` type from `@opencode-ai/sdk/v2` (type-only)
- `DEFAULT_REQUEST_TIMEOUT_MS`, `stripMarkdownFences`, `tryParseJSON` from `./base.ts`
- `ProviderJsonParseError` from `./types.ts`
- `AdapterResponse`, `OpenCodeOptions` from `./types.ts`

**New internal helpers (not exported):**
1. `resolveOpenCodeBaseUrl(opencode)` — deterministic base URL resolution: `opencode.baseUrl` → `PO_OPENCODE_BASE_URL` → `OPENCODE_BASE_URL` → `undefined`
2. `extractOpenCodeContent(raw, responseFormat, model)` — shared response processing: structured output → JSON text parsing → text mode. Throws `ProviderJsonParseError` for invalid JSON in json mode.
3. `runOpenCodeCli(args, env, timeoutMs)` — spawns `opencode` CLI, reads NDJSON events, accumulates text from `{ type: "text", part: { text } }` events, kills on timeout.

**`extractOpenCodeText` updated:**
- Added `parts` array handling (SDK prompt response shape) alongside existing `content` and `events` handling

**`opencodeChat` (exported):**
- SDK path: resolves base URL → `createOpencodeClient` → session create/reuse → prompt with format/permission/model/agent/directory → response extraction
- CLI path: builds `opencode run --format json` args with explicit optional flags → sets `OPENCODE_PERMISSION` env → spawns subprocess → parses NDJSON → response extraction
- Mode selection: `opencode.mode` if set, otherwise SDK if base URL available, otherwise CLI

**`isOpenCodeAvailable` (exported):**
- Returns `true` if `PO_OPENCODE_BASE_URL` or `OPENCODE_BASE_URL` is set
- Otherwise tries `Bun.spawnSync(["opencode", "--version"], { timeout: 5000 })` → exitCode 0
- Returns `false` on failure/throw
- No interactive commands

### `src/providers/__tests__/opencode.test.ts`

Added 33 new tests across these describe blocks:
- **SDK session lifecycle** (8 tests): base URL, fresh session, explicit sessionId, permissions, model/agent/directory forwarding, error handling, missing URL
- **SDK JSON-schema request mapping** (3 tests): format mapping, retryCount inclusion/omission
- **SDK structured output as content** (2 tests): structured output → content, raw preservation
- **JSON text response parsing** (2 tests): fenced JSON, plain JSON
- **JSON parse errors** (1 test): `ProviderJsonParseError` with correct provider/model
- **text mode responses** (2 tests): string content, raw preservation
- **CLI mode fallback** (7 tests): command args, OPENCODE_PERMISSION, text accumulation, non-zero exit, malformed events, timeout kill, omitted optional args
- **isOpenCodeAvailable** (6 tests): env vars, CLI success/failure/throw, no interactive args

Mock pattern: `vi.mock("@opencode-ai/sdk/v2")` at module level with `mockCreate`/`mockPrompt` vi.fn() refs; per-test `mockResolvedValueOnce` for response overrides. CLI tests use `vi.spyOn(Bun, "spawn")` with mock ReadableStreams.

## Verification

```bash
bun test src/providers/__tests__/opencode.test.ts
# 64 pass, 0 fail

bun run typecheck
# Clean
```

## Assumptions and risks

1. **SDK `session.create` and `session.prompt` accept one argument** — the SDK RequestResult wraps `data`/`error`; we use default `ThrowOnError = false` and check `result.error` manually.
2. **`extractOpenCodeText` was missing `parts` handling** — the SDK prompt response uses `parts` (not `content`); added handling for this shape.
3. **CLI timeout mechanism** — `proc.kill()` closes the stdout stream; the mock test verifies this by closing the controller in the kill handler.
4. **`AbortController` in SDK path is wired but not passed to the SDK call** — the SDK client doesn't accept an AbortSignal directly in its current API, so the timer is a safety net that clears on completion. A hung SDK call would need server-side timeout or connection-level abort.

## Spec discrepancies

None identified. All conformance guardrails from the spec are met:
- Safe-by-default permissions (`{ "*": "deny" }`)
- No `createOpencode`/`createOpencodeServer` usage
- Deterministic base URL resolution order
- CLI optional args stay explicit
- SDK import uses typed v2 client surface
- CLI never bypasses permissions
- Availability check stays non-interactive
