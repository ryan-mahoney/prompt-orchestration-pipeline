# Step 1: Rewrite `normalizeOpenCodeUsage` for the nested token shape

## Target files/symbols

- `src/providers/opencode.ts` — `normalizeOpenCodeUsage` function (lines 232–262)
- `src/providers/__tests__/opencode.test.ts` — `describe("normalizeOpenCodeUsage")` block (lines 238–262)
- `src/providers/types.ts` — `AdapterUsage` interface (reference only, no changes)

## Current state

`normalizeOpenCodeUsage` reads flat fields from `info`:
- `info.prompt_tokens` / `info.input_tokens`
- `info.completion_tokens` / `info.output_tokens`
- `info.total_tokens`

The SDK `AssistantMessage` exposes `info.tokens.{input, output, total}`. The flat reads never match, so usage is always dropped.

## Ordered concrete edit sequence

### 1. Rewrite `normalizeOpenCodeUsage` in `src/providers/opencode.ts`

Replace lines 232–262 with logic that:
1. Returns `undefined` if `raw` is null/non-object
2. Reads `info = (raw as Record<string, unknown>).info`
3. Returns `undefined` if `info` is null/non-object
4. Reads `tokens = (info as Record<string, unknown>).tokens`
5. Returns `undefined` if `tokens` is null/non-object
6. Reads `input = (tokens as Record<string, unknown>).input`, `output = (tokens as Record<string, unknown>).output`
7. Returns `undefined` if either `input` or `output` is not a number
8. Reads `total = (tokens as Record<string, unknown>).total`
9. Computes `total_tokens = typeof total === "number" ? total : input + output`
10. Returns `{ prompt_tokens: input, completion_tokens: output, total_tokens }`

### 2. Update tests in `src/providers/__tests__/opencode.test.ts`

Replace the existing `describe("normalizeOpenCodeUsage")` block (lines 238–262) with tests that:
- Assert mapping from `{ info: { tokens: { input: 100, output: 50 } } }` → `{ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }` (AC-1)
- Assert `total` override: `{ info: { tokens: { input: 100, output: 50, total: 200 } } }` → `total_tokens: 200` (AC-2)
- Assert `undefined` for: missing `info` (null), missing `tokens`, missing `output`, non-numeric `input` (AC-3)

## Test cases

1. **AC-1**: `{ info: { tokens: { input: 100, output: 50 } } }` → `{ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }`
2. **AC-2**: `{ info: { tokens: { input: 100, output: 50, total: 200 } } }` → `{ prompt_tokens: 100, completion_tokens: 50, total_tokens: 200 }`
3. **AC-3a**: `null` → `undefined`
4. **AC-3b**: `{}` → `undefined`
5. **AC-3c**: `{ info: {} }` → `undefined`
6. **AC-3d**: `{ info: { tokens: {} } }` → `undefined` (missing input/output)
7. **AC-3e**: `{ info: { tokens: { input: 100 } } }` → `undefined` (missing output)
8. **AC-3f**: `{ info: { tokens: { input: "not-a-number", output: 50 } } }` → `undefined`

## Stop conditions

- If `AdapterUsage` type changes, stop and report.
- If the function signature changes from `normalizeOpenCodeUsage(raw: unknown): AdapterUsage | undefined`, stop and report.
