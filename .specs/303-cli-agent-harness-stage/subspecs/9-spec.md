# Subspec: Step 9 — Validate the `agent` entry kind

## Goal
Extend pipeline entry types and validation to accept and enforce `agent` entries per §4 of the spec.

## Target files
1. `src/core/pipeline-definition.ts` — add `agent` to `PipelineTaskEntry` interface
2. `src/core/validation.ts` — add `agent` to allowed keys + validate agent config rules
3. `src/core/__tests__/validation.test.ts` — add test cases for agent validation

## Current state
- `PipelineTaskEntry` has `name`, `task?`, `config?`, `gate?`
- `validatePipelineTaskEntry` allows keys `{"name","task","config","gate"}` and validates each
- `AgentEntryConfig` already exists in `src/harness/types.ts` with `harness`, `model?`, `prompt?`, `promptFrom?`, `cwd?`, `io?`, `timeoutMs?`, `captureDiff?`
- `HarnessName = "claude" | "codex" | "opencode"`

## Edit sequence

### 1. `src/core/pipeline-definition.ts`
- Add import: `import type { AgentEntryConfig } from "../harness/types";`
- Add `agent?: AgentEntryConfig` to `PipelineTaskEntry` interface (after `gate?`)

### 2. `src/core/validation.ts`
- Add import: `import type { HarnessName } from "../harness/types";`
- In `validatePipelineTaskEntry`: add `"agent"` to `allowedKeys` set
- Add mutual exclusion check: if entry has both `agent` and `gate`, push error; if entry has both `agent` and `task`, push error
- Add call to new `validatePipelineTaskAgent(task["agent"], path, errors)` when `"agent" in task`
- Add new `validatePipelineTaskAgent` function:
  - If `agent` is not a plain object → error "agent must be a plain object"
  - If `agent.harness` is missing or not in `{"claude","codex","opencode"}` → error
  - If neither `agent.prompt` nor `agent.promptFrom` is a non-empty string → error
  - If both `agent.prompt` and `agent.promptFrom` are non-empty strings → error

### 3. `src/core/__tests__/validation.test.ts`
Add `describe("agent entry validation", ...)` with these tests:
- Valid agent entry with `prompt` parses
- Valid agent entry with `promptFrom` parses
- Missing harness → error containing "harness"
- Unknown harness value → error containing "harness"
- Neither prompt nor promptFrom → error
- Both prompt and promptFrom → error
- Entry with both `gate` and `agent` → error
- Entry with both `task` and `agent` → error
- Agent that is not a plain object → error

## Test target
`src/core/__tests__/validation.test.ts` — append to existing file

## Stop conditions
- All 6 spec test cases pass
- Existing validation tests still pass
- typecheck passes
