# Steps 4–9: OpenCode Pure Helper Functions

## Scope

Create `src/providers/opencode.ts` with pure helper functions for model parsing, prompt building, JSON format detection, permission normalization, structured output extraction, text extraction, and usage normalization. Create `src/providers/__tests__/opencode.test.ts` covering all helpers.

## File: `src/providers/opencode.ts`

### Imports

- Import `ChatMessage`, `ResponseFormatObject`, `OpenCodePermissionConfig`, `OpenCodePermissionRule`, `OpenCodePermissionAction`, `AdapterUsage` from `./types.ts`
- Import `stripMarkdownFences` from `./base.ts` (not needed for these helpers, skip)

### Step 4: `parseOpenCodeModel`

```ts
export type ParsedOpenCodeModel = { providerID: string; modelID: string } | null;

export function parseOpenCodeModel(model: string | undefined): ParsedOpenCodeModel
```

- `undefined`, `""`, `"default"` → `null`
- Valid `"provider/model"` → `{ providerID, modelID }`
- Invalid: no slash (`"anthropic"`), empty provider (`"/model"`), empty model (`"provider/"`), too many slashes (`"provider/model/extra"`) → throw `Error`

### Step 5: Prompt and JSON-format helpers

```ts
export function buildOpenCodePromptText(messages: ChatMessage[]): string
export function isJsonMode(responseFormat: string | ResponseFormatObject | undefined): boolean
export function jsonSchemaFromResponseFormat(responseFormat: string | ResponseFormatObject | undefined): unknown | undefined
```

- `buildOpenCodePromptText`: preserves system, user, assistant content in request order, joined by `\n\n` with `role: content` format
- `isJsonMode`: true for `"json"`, `"json_object"`, `{ type: "json_object" }`, `{ json_schema: ... }`
- `jsonSchemaFromResponseFormat`: returns `json_schema` object only when present on an object format

### Step 6: Permission helpers

```ts
export function defaultOpenCodePermission(): OpenCodePermissionConfig
export function normalizeOpenCodePermission(permission: OpenCodePermissionConfig): OpenCodePermissionRule[]
```

- `defaultOpenCodePermission()` → `{ "*": "deny" }`
- `normalizeOpenCodePermission`:
  - String action (e.g. `"deny"`) → `[{ permission: "*", pattern: "*", action }]`
  - Object `{ "*": "deny", read: "allow" }` → expand to rules with `pattern: "*"`
  - Object with nested `{ read: { "/tmp/*": "allow" } }` → expand to rules with specific patterns
  - Array of rules → pass through as-is

### Step 7: Structured output extraction

```ts
export function extractOpenCodeStructuredOutput(raw: unknown): Record<string, unknown> | undefined
```

- Expects SDK response shape with `info.structured`
- Returns structured object when present, `undefined` otherwise

### Step 8: Text extraction

```ts
export function extractOpenCodeText(raw: unknown): string
```

- Accumulates text from SDK text parts (`content[].text`) and CLI text events (`{ type: "text", part: { text } }`)
- Unknown parts/events ignored
- Returns concatenated text

### Step 9: Usage normalization

```ts
export function normalizeOpenCodeUsage(raw: unknown): AdapterUsage | undefined
```

- Maps SDK token metadata to `{ prompt_tokens, completion_tokens, total_tokens }`
- Returns `undefined` when metadata absent

## File: `src/providers/__tests__/opencode.test.ts`

### Test groups

1. **parseOpenCodeModel** (7 tests)
   - returns null for undefined
   - returns null for empty string
   - returns null for "default"
   - parses valid "provider/model"
   - throws for "anthropic" (no slash)
   - throws for "/model" (empty provider)
   - throws for "provider/" (empty model)
   - throws for "provider/model/extra" (too many slashes)

2. **buildOpenCodePromptText** (2 tests)
   - includes all message roles in order
   - handles empty messages

3. **isJsonMode** (5 tests)
   - true for "json"
   - true for "json_object"
   - true for { type: "json_object" }
   - true for { json_schema: {} }
   - false for undefined
   - false for "text"

4. **jsonSchemaFromResponseFormat** (3 tests)
   - returns schema when json_schema present
   - returns undefined for string format
   - returns undefined when json_schema absent

5. **defaultOpenCodePermission** (1 test)
   - returns exactly { "*": "deny" }

6. **normalizeOpenCodePermission** (4 tests)
   - string "deny" produces deny rule for "*"
   - object with granular patterns preserves them
   - explicit rule array passes through
   - no normalized default rule uses "ask" or "allow"

7. **extractOpenCodeStructuredOutput** (2 tests)
   - extracts from SDK info.structured
   - returns undefined when missing

8. **extractOpenCodeText** (3 tests)
   - extracts from SDK text parts
   - extracts from CLI text events
   - ignores unknown events

9. **normalizeOpenCodeUsage** (2 tests)
   - normalizes from SDK metadata
   - returns undefined when absent

## Conformance

- Pure functions only; no SDK/CLI calls
- Safe-by-default: `{ "*": "deny" }`
- No `createOpencode`, `createOpencodeServer`, `opencode serve`
