# Step 4: Type the SDK test fixtures against the real SDK shape

## Target files/symbols

- `src/providers/__tests__/opencode.test.ts` — `defaultPromptData` fixture (line 290-308)
- SDK type: `import("@opencode-ai/sdk/v2").AssistantMessage` (line 213-246 of `dist/v2/gen/types.gen.d.ts`)
- SDK response type: `SessionPromptResponses[200]` = `{ info: AssistantMessage; parts: Array<Part>; }`

## Current state

`defaultPromptData` (line 290-308) is an untyped object literal with correct nested token shape from steps 1-3, but missing required `AssistantMessage` fields (`parentID`, `mode`, `path`) and using `as const` on `role` without full type alignment.

## Ordered concrete edit sequence

1. Add `import type { AssistantMessage } from "@opencode-ai/sdk/v2"` to the imports (line 1 area).
2. Type `defaultPromptData` as `{ info: AssistantMessage; parts: [TextPart] }` (or just type the `info` field).
3. Add missing required `AssistantMessage` fields to the `info` object: `parentID`, `mode`, `path`.
4. Type the `parts` array element as a `TextPart` with required `id`, `sessionID`, `messageID` fields.
5. Verify no invented flat-token fixtures remain (they were already removed in steps 1-3).

## Test cases

- No new test cases — the fixture itself is the assertion. It must compile against the SDK type.
- Existing structured-output and text-extraction tests reuse `defaultPromptData` unchanged.

## Stop conditions

- If the SDK type has changed shape vs what the spec describes, STOP and report.
