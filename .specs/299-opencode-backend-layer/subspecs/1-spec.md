# Step 1: Add OpenCode Provider Types

## What to modify

**`src/providers/types.ts`:**
1. Add `"opencode"` to `ProviderName` union — between `"alibaba"` and `"mock"`.
2. Add `opencode: boolean` to `ProviderAvailability` — between `alibaba` and `mock`.
3. Add OpenCode-specific types (after the existing provider option interfaces, before telemetry types):
   - `OpenCodePermissionAction` — `"allow" | "ask" | "deny"`
   - `OpenCodePermissionKey` — union of 15 known permission keys
   - `OpenCodePermissionName` — `OpenCodePermissionKey | "*" | (string & {})`
   - `OpenCodePermissionRule` — `{ permission, pattern, action }`
   - `OpenCodePermissionConfig` — union of action string, partial record, or rules array
   - `OpenCodeRequestConfig` — `{ mode?, baseUrl?, sessionId?, agent?, directory?, permission?, structuredOutputRetryCount? }`
   - `OpenCodeOptions` — extends `ProviderOptions` with optional `opencode?: OpenCodeRequestConfig`
4. Add `opencode?: OpenCodeRequestConfig` to `ChatOptions`.

**`src/providers/__tests__/types.test.ts`:**
- Add a compile-time usage test: construct a `ChatOptions` object with `provider: "opencode"` and nested `opencode` config, assert provider and config shape.

## Conformance guardrails
- All existing providers remain present (direct providers additive peers).
- OpenCode types confined to provider layer.
- No SDK helpers or server startup — types only.
- Safe-by-default permission types match `{ "*": "deny" }` default pattern.

## Verification
- `bun run typecheck`
- `bun test src/providers/__tests__/types.test.ts`
