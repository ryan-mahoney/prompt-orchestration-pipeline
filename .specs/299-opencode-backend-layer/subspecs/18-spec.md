# Subspec: Steps 18–23 — Wire OpenCode into the LLM Gateway

## Summary

Wire `opencodeChat` and `isOpenCodeAvailable` from `src/providers/opencode.ts` into `src/llm/index.ts` and add gateway-level tests covering dispatch, override, availability, telemetry, cost, and usage fallback.

## Files Modified

- `src/llm/index.ts` — import adapter + availability, add `case "opencode"` in `callAdapter`, replace `opencode: false` with `opencode: isOpenCodeAvailable()`
- `src/llm/__tests__/index.test.ts` — add six OpenCode gateway tests

## Changes to `src/llm/index.ts`

1. Add import: `import { opencodeChat, isOpenCodeAvailable } from "../providers/opencode.ts";`
2. Add `case "opencode"` in `callAdapter` switch (before `case "mock"`):
   ```ts
   case "opencode":
     return opencodeChat({
       messages, model, responseFormat, maxRetries, requestTimeoutMs,
       opencode: options.opencode,
     });
   ```
3. Replace `opencode: false` in `getAvailableProviders()` with `opencode: isOpenCodeAvailable()`

## Tests to Add

All tests mock the OpenCode adapter via `vi.mock("../../providers/opencode.ts", ...)` or use `registerMockProvider` pattern. Follow existing vitest patterns in the file.

1. **dispatch**: `chat({ provider: "opencode" })` returns standard `ChatResponse` shape
2. **override**: `createLLMWithOverride({ provider: "opencode", model })` routes calls through opencode
3. **availability**: `getAvailableProviders()` includes `opencode` and reflects mocked availability
4. **complete telemetry**: successful opencode call emits `llm:request:complete` with provider `opencode`, requested model, numeric token counts, cost `0`
5. **error telemetry**: failed opencode call emits `llm:request:error` with provider `opencode` and error message
6. **usage fallback**: missing adapter usage produces estimated token counts (numeric, non-zero)

## Steps 21–23: No Code Changes

The existing gateway handles telemetry, cost (`calculateCost` returns 0 for unknown models), and usage fallback generically. Steps 21–23 are verified by tests only.

## Verification

```bash
bun test src/llm/__tests__/index.test.ts
bun run typecheck
```
