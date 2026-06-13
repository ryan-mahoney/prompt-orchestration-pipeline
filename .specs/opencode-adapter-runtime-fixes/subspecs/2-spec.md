# Step 2: Add bounded `deleteOpenCodeSession` cleanup helper

## Target files

- `src/providers/opencode.ts` — add constant + internal function after `normalizeOpenCodeUsage` (around line 255)
- `src/providers/__tests__/opencode.test.ts` — add `mockDelete` to SDK mock, add helper unit tests

## Current state

- `normalizeOpenCodeUsage` ends at line 255.
- `resolveOpenCodeBaseUrl` starts at line 257.
- Test mock at line 312-324 has `mockCreate` and `mockPrompt` only; no `session.delete`.
- `OpencodeClient` is imported from `@opencode-ai/sdk/v2` at line 5.

## Edit sequence

### 1. `src/providers/opencode.ts`

Insert after `normalizeOpenCodeUsage` (line 255), before `resolveOpenCodeBaseUrl`:

```ts
const SESSION_DELETE_TIMEOUT_MS = 5000;

async function deleteOpenCodeSession(
  client: OpencodeClient,
  sessionID: string,
  timeoutMs: number = SESSION_DELETE_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await client.session.delete({ sessionID }, { signal: controller.signal });
  } catch {
    // Cleanup failures must never mask the primary result/error.
  } finally {
    clearTimeout(timer);
  }
}
```

### 2. `src/providers/__tests__/opencode.test.ts`

a. Add `mockDelete` to `vi.hoisted` block (line 312):
   - Change destructuring to include `mockDelete: vi.fn()`
   - Add `delete: mockDelete` to the mock client's `session` object

b. Add test cases inside the `"opencodeChat"` describe block (after "SDK session lifecycle" or as a new describe):
   - Test: `session.delete` receives an `AbortSignal` in its options argument (call `opencodeChat`, inspect `mockDelete` call args)
   - Test: a rejecting `session.delete` does not cause `opencodeChat` to reject (mock `mockDelete` to reject, assert `opencodeChat` resolves)

## Test cases

1. `"session.delete receives an AbortSignal in its options argument"` — call `opencodeChat` with SDK mode, verify `mockDelete` was called with `({ sessionID }, { signal: expect.any(AbortSignal) })`
2. `"a rejecting session.delete does not cause opencodeChat to reject"` — `mockDelete.mockRejectedValueOnce(new Error('delete failed'))`, call `opencodeChat`, assert it resolves successfully

## Stop conditions

- If `session.delete` is not on the mock client type, stop and report.
- If `OpencodeClient` type does not include `session.delete`, stop and report.
