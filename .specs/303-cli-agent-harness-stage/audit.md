# Audit: CLI Agent Harness Stage

- Branch: `303-cli-agent-harness-stage`
- Scope: `git diff 521c9232ee2bf93bc9e352c81c2ed26df0a2760d...HEAD`
- Merge-base: `521c9232ee2bf93bc9e352c81c2ed26df0a2760d`
- Audited HEAD: `4ca277e32e6a95dba201f2beafecf5dd0ec5a5f8`
- Criteria: `.specs/303-cli-agent-harness-stage/criteria.md`
- Criteria compile baseline: `521c9232ee2bf93bc9e352c81c2ed26df0a2760d`
- Date: `2026-06-13T17:41:05Z`
- Verdict counts: PASS=11, VIOLATION=0, UNVERIFIABLE=1

## Verdict Table

| Criterion | Mode | Title | Verdict |
| --- | --- | --- | --- |
| C-1 | G | shared harness contracts stay in `src/harness/types.ts` | PASS |
| C-2 | D | JSONL subprocess runner preserves the OpenCode CLI precedent | PASS |
| C-3 | G | harness-specific argv/env logic stays descriptor-owned | PASS |
| C-4 | G | Codex auth/config store is not replaced | UNVERIFIABLE |
| C-5 | S | MCP tools delegate to `TaskFileIO` | PASS |
| C-6 | S | MCP transport stays in-process HTTP, not stdio or child-process based | PASS |
| C-7 | G | agent event logs use POP log naming | PASS |
| C-8 | G | agent outputs go through `TaskFileIO` | PASS |
| C-9 | S | diff capture never mutates the real git index | PASS |
| C-10 | S | pipeline config validation stays in the validation layer | PASS |
| C-11 | S | runner handles agent entries before task registry lookup | PASS |
| C-12 | G | no new harness SDK dependency | PASS |

## Findings

No violations.

## Unverifiable

### C-4 (G) - Codex auth/config store is not replaced

Compiled check:

```sh
rg -n "CODEX_HOME" src/harness src/core
```

Expected: no matches.

Actual:

```txt
src/harness/__tests__/descriptors.test.ts:159:  it("does not set CODEX_HOME", () => {
src/harness/__tests__/descriptors.test.ts:161:    expect(result.env.CODEX_HOME).toBeUndefined();
```

This is a criteria defect, not a code finding: the command searches test files, and the only hits assert the required absence of `CODEX_HOME`. The structural production read found no `CODEX_HOME` assignment in `src/harness/descriptors/codex.ts` or `src/harness/executor.ts`.

## Pre-existing

None.

## Ledger Results

### Establishing phase: N/A

| Invariant | Verdict | Evidence |
| --- | --- | --- |
| I-1 - Harness contracts stay centralized | PASS | `src/harness/types.ts:1`, `src/harness/types.ts:3`, `src/harness/types.ts:8`, `src/harness/types.ts:14`, `src/harness/types.ts:21`, `src/harness/types.ts:32`, `src/harness/types.ts:41`, `src/harness/types.ts:56`, `src/harness/types.ts:67` contain the exported harness contracts and no other production file does. |
| I-2 - Harness-specific CLI details stay descriptor-owned | PASS | New production hits are descriptor-owned: `src/harness/descriptors/claude.ts:15`, `src/harness/descriptors/claude.ts:19`, `src/harness/descriptors/codex.ts:13`, `src/harness/descriptors/codex.ts:14`, `src/harness/descriptors/codex.ts:21`, `src/harness/descriptors/codex.ts:23`, `src/harness/descriptors/codex.ts:32`, `src/harness/descriptors/opencode.ts:3`, `src/harness/descriptors/opencode.ts:18`, `src/harness/descriptors/opencode.ts:27`, `src/harness/descriptors/opencode.ts:45`; the only provider hit is pre-existing chat-provider `src/providers/opencode.ts:529`. |
| I-3 - Codex auth/config store remains available | UNVERIFIABLE | Same criteria defect as C-4: the suggested command matches tests that assert the invariant rather than production code that violates it. Production descriptor code sets only `POP_MCP_TOKEN` at `src/harness/descriptors/codex.ts:31`. |
| I-4 - Agent file effects stay `TaskFileIO`-owned | PASS | `src/harness/mcp-io-server.ts:31`, `src/harness/mcp-io-server.ts:45`, `src/harness/mcp-io-server.ts:55`, `src/harness/mcp-io-server.ts:66`, `src/harness/mcp-io-server.ts:76`, and `src/harness/mcp-io-server.ts:87` register the specced tools and delegate to `TaskFileIO`; `src/core/agent-step.ts:126`, `src/core/agent-step.ts:132`, and `src/core/agent-step.ts:56` write logs/artifacts through `io`. |
| I-5 - MCP transport remains in-process HTTP | PASS | `src/harness/mcp-io-server.ts:1` uses `node:http`, `src/harness/mcp-io-server.ts:4` imports `StreamableHTTPServerTransport`, `src/harness/mcp-io-server.ts:19` defaults host to `127.0.0.1`, and no stdio transport or subprocess spawn appears in the file. |
| I-6 - Diff capture never stages operator changes | PASS | `src/core/agent-step.ts:37` constructs `env` with `GIT_INDEX_FILE`, and `src/core/agent-step.ts:41`, `src/core/agent-step.ts:44`, `src/core/agent-step.ts:48`, and `src/core/agent-step.ts:51` run read-tree/add/diff with that env; `src/core/agent-step.ts:60`-`63` removes the temp index. |
| I-7 - Pipeline validation stays in `validation.ts` | PASS | `src/core/pipeline-definition.ts:5`-`10` adds the shape only; `src/core/validation.ts:195`-`212` owns agent mutual-exclusion checks and `src/core/validation.ts:275`-`321` owns agent config validation; the runner assumes validated input. |
| I-8 - Harness execution remains CLI-only | PASS | `package.json:73` adds `@modelcontextprotocol/sdk`; no Codex or Claude agent SDK dependency is present. |
