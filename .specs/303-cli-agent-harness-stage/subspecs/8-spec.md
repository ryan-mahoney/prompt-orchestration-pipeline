# Step 8: Add optional diff capture

## Target files
- `src/core/agent-step.ts` — add `captureDiff` logic after `agent-result.md` write
- `src/core/__tests__/agent-step.test.ts` — add 4 tests for AC-13

## Current state
- `AgentEntryConfig.captureDiff?: boolean` already exists in `src/harness/types.ts:64`
- `runAgentStep` at `src/core/agent-step.ts:77` writes `agent-result.md`, then returns
- No git-related code exists in agent-step.ts yet

## Edit sequence

### 1. `src/core/agent-step.ts`

**Add import:** `import { randomUUID } from "node:crypto";`

**Add helper function** `captureDiff(io, cwd)` after imports, before `runAgentStep`:
- Check if cwd is a git repo: `git -C <cwd> rev-parse --is-inside-work-tree` (exit code check)
- If not a repo, return (skip without error)
- Create temp index path: `/tmp/pop-index-<randomUUID()>`
- Try:
  - Check if HEAD exists: `git -C <cwd> rev-parse --verify HEAD` (exit code check)
  - If HEAD exists: `GIT_INDEX_FILE=<tmp> git -C <cwd> read-tree HEAD`
  - Else: `GIT_INDEX_FILE=<tmp> git -C <cwd> read-tree --empty`
  - `GIT_INDEX_FILE=<tmp> git -C <cwd> add -A`
  - `GIT_INDEX_FILE=<tmp> git -C <cwd> diff --cached --binary`
  - If stdout is non-empty, `io.writeArtifact("agent.patch", diff)`
- Finally: remove temp index file if it exists

**Modify `runAgentStep` success path** (after line 77 `writeArtifact("agent-result.md", ...)`):
```ts
if (args.entry.captureDiff) {
  await captureDiff(io, cwd);
}
```

**Update `allArtifacts`** to include `"agent.patch"` conditionally:
```ts
const hasPatch = args.entry.captureDiff && args.entry.io !== false;
// ... or check if agent.patch was written
```

Simpler: after diff capture, just always include `"agent.patch"` in the success-path artifacts list when `captureDiff` is true. The patch may be empty but the artifact name is still registered.

### 2. `src/core/__tests__/agent-step.test.ts`

**Add helper:** `createCaptureDiffDeps(cwd)` — creates deps with `createTaskFileIO` returning a `capturingIO` (enhanced fake that stores `writeArtifact` content in a `Map<string, string>`).

**Test cases:**

1. **"captureDiff writes agent.patch with tracked and untracked changes in a repo"**
   - Create temp dir, `git init`, create+commit a file, modify it, add an untracked file
   - Run with `captureDiff: true`
   - Assert `capturingIO.artifacts.get("agent.patch")` contains the changes
   - Clean up temp dir

2. **"captureDiff captures changes against empty tree when no HEAD"**
   - Create temp dir, `git init` (no commits)
   - Create files
   - Run with `captureDiff: true`
   - Assert patch contains the new files
   - Clean up

3. **"captureDiff does not mutate the real git index"**
   - Create temp dir, `git init`, commit, modify files
   - Run `git diff-index HEAD` before and after
   - Assert index state is identical
   - Clean up

4. **"captureDiff with non-repo cwd does not throw and writes no patch"**
   - Create temp dir (no git init)
   - Run with `captureDiff: true`
   - Assert result.ok is true, no agent.patch in artifacts
   - Clean up

## Verification
- `bun test src/core/__tests__/agent-step.test.ts` — all tests pass
- `bun run typecheck` — no type errors
