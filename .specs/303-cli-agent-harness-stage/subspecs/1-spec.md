# Step 1: Add shared types

## Target file

- `src/harness/types.ts` (new)

## Target test file

- `src/harness/__tests__/types.test.ts` (new)

## Concrete edit sequence

1. Create `src/harness/types.ts` with all 9 interfaces/types from spec §4, exported:
   - `HarnessName` (union type)
   - `McpServerConnection` (interface)
   - `HarnessUsage` (interface)
   - `HarnessEvent` (interface)
   - `HarnessRunOptions` (interface)
   - `HarnessRunResult` (interface)
   - `HarnessDescriptor` (interface)
   - `AgentEntryConfig` (interface)
   - `AgentStepResult` (interface)

2. Create `src/harness/__tests__/types.test.ts` with compile-time type tests:
   - Construct each interface shape and assert basic field access
   - Verify `HarnessName` union accepts only the three values
   - Verify `HarnessEvent.type` discriminated union values
   - Verify `HarnessDescriptor` methods have correct signatures

## Test cases

1. `HarnessName` — assign each valid value, verify it's a string union
2. `McpServerConnection` — construct with url + token
3. `HarnessUsage` — construct with all three token counts
4. `HarnessEvent` — construct each event type variant
5. `HarnessRunOptions` — construct with required fields only, then with all optional fields
6. `HarnessRunResult` — construct with required fields only, then with all optional fields
7. `HarnessDescriptor` — construct a minimal descriptor, verify method signatures
8. `AgentEntryConfig` — construct with required fields only, then with all optional fields
9. `AgentStepResult` — construct with required fields only, then with all optional fields

## Notes

- Project uses vitest (not bun:test as AGENTS.md suggests). Follow project convention: `import { describe, it, expect } from "vitest"`.
- The test file is compile-time focused: constructing valid shapes and asserting field access. This validates the contract surface (AC-1, AC-3).
- No runtime behavior to test — these are pure type definitions.
- Types are self-contained; no imports from other project modules needed.

## Stop conditions

- If any type shape from the spec doesn't match what's needed by downstream modules, stop and report.
