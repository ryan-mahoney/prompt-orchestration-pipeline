# Step 3: Add the SDK dependency

## What to do

Add `@opencode-ai/sdk` to the `"dependencies"` object in `package.json` (NOT devDependencies), then run `bun install` to refresh `bun.lock`.

## Why

The primary OpenCode integration path uses the official JS/TS SDK (`@opencode-ai/sdk/v2`). This must be a production dependency because the OpenCode provider adapter imports it at runtime.

## Files to modify

- `package.json` — add `"@opencode-ai/sdk": "^1.17.4"` to `"dependencies"`
- `bun.lock` — refreshed by `bun install`

## Conformance guardrails

- Keep POP as the orchestration owner (no other changes).
- SDK dependency must be in `dependencies`, not `devDependencies`.

## Verification

- `bun install` completes without error.
- `bun run typecheck` passes (dependency resolves).
- `package.json` shows `@opencode-ai/sdk` under `"dependencies"`.

## Covers

- Architecture dependency on `@opencode-ai/sdk/v2`
