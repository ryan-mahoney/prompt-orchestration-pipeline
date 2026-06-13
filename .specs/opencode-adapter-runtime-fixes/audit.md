# Spec Audit: OpenCode Adapter Runtime Correctness Fixes

- Branch: `299-add-opencode-prompt-runner-provider`
- Merge base with `main`: `82d5db3bee82c99def85a90f939014bc7dba5589`
- HEAD: `e9d2f722c22a859f7924754fa3c0478df1d2619b`
- Audit scope (per criteria target): `git diff 7f3f0810f1e2ba80522069302fdb42aef594fab0...HEAD` — commits `4e9c659`, `d350da9`, `cb139f5`, `e9d2f72`
- Criteria file: `.specs/opencode-adapter-runtime-fixes/criteria.md` (compile baseline `7f3f0810f1e2ba80522069302fdb42aef594fab0`)
- Date: 2026-06-13
- Verdict counts: PASS=9, VIOLATION=0, UNVERIFIABLE=0 (T register: 12, owned by CI, not audited)
- Ledger counts: PASS=2, VIOLATION=0

## Verdict Table

| Criterion | Mode | Title | Verdict |
| --- | --- | --- | --- |
| C-1 | G | Change scope limited to allowed source files | PASS |
| C-2 | G | No new dependency added | PASS |
| C-3 | G | No `as unknown` cast on the `session.prompt` call | PASS |
| C-4 | G | No circuit breaker / bulkhead machinery added | PASS |
| C-5 | S | Missing-base-URL error thrown before the retry loop | PASS |
| C-6 | S | SDK client created once above the retry loop | PASS |
| C-7 | S | Fresh session per call; no module-level pool | PASS |
| C-8 | S | No usage-provenance field added | PASS |
| C-9 | S | Permission defaults and availability checks untouched | PASS |
| INV-1 | X | Token estimation gateway-owned; adapter never estimates | PASS |
| INV-2 | X | Adapter deletes only sessions it created | PASS |

## Criterion Evidence

### C-1 (G) — PASS

Command: `git diff --name-only 7f3f081...HEAD -- src/`

Output is exactly `src/llm/__tests__/index.test.ts`, `src/providers/__tests__/opencode.test.ts`, `src/providers/opencode.ts` — all three in the allowed set. No `src/llm/index.ts`, `src/providers/types.ts`, `src/config/models.ts`, or docs changes.

### C-2 (G) — PASS

Command: `git diff --stat 7f3f081...HEAD -- package.json bun.lock` produced no output. No dependency added.

### C-3 (G) — PASS

Command: `rg -n "as unknown" src/providers/opencode.ts` returned no matches. The `session.prompt` call ([opencode.ts:491](src/providers/opencode.ts#L491)) is plainly typed; `promptParams` is declared `Parameters<typeof client.session.prompt>[0]` ([opencode.ts:458](src/providers/opencode.ts#L458)), so a future SDK signature change fails compilation.

### C-4 (G) — PASS

Command: `rg -ni "circuit|breaker|bulkhead" src/providers/opencode.ts` returned no matches. The deferred stability scaffolding was not implemented.

### C-5 (S) — PASS

Question: Is the `baseUrl == null` throw evaluated once before the retry loop?

Evidence: The guard is at [opencode.ts:407-412](src/providers/opencode.ts#L407-L412), inside `if (mode === "sdk")` but before the `for` loop, which begins at [opencode.ts:421](src/providers/opencode.ts#L421). Fail-fast confirmed.

### C-6 (S) — PASS

Question: Is `createOpencodeClient` called once above the loop, not per attempt?

Evidence: `const client = createOpencodeClient({ baseUrl })` at [opencode.ts:414](src/providers/opencode.ts#L414), outside the `for` loop ([opencode.ts:421](src/providers/opencode.ts#L421)). The `finally` cleanup at [opencode.ts:527-531](src/providers/opencode.ts#L527-L531) uses this stable reference.

### C-7 (S) — PASS

Question: Fresh session per call with no module-level pool?

Evidence: `sdkSessionID` initializes from the caller-supplied `opencode.sessionId` else `undefined` ([opencode.ts:415-416](src/providers/opencode.ts#L415-L416)); a fresh session is created via `client.session.create` ([opencode.ts:444](src/providers/opencode.ts#L444)) only when none was supplied ([opencode.ts:423](src/providers/opencode.ts#L423)). No module-level session cache, pool, or reuse map exists in the file.

### C-8 (S) — PASS

Question: Is no `provenance`/`estimated`/`measured` flag added to usage shapes or the complete event?

Evidence: `normalizeOpenCodeUsage` returns exactly `{ prompt_tokens, completion_tokens, total_tokens }` ([opencode.ts:250-254](src/providers/opencode.ts#L250-L254)). `AdapterUsage`/`NormalizedUsage` (in `src/providers/types.ts`) and the gateway event (in `src/llm/index.ts`) are unchanged — neither file is in the C-1 changed set. The deferred provenance feature was not smuggled in.

### C-9 (S) — PASS

Question: Do `defaultOpenCodePermission`, `normalizeOpenCodePermission`, `isOpenCodeAvailable`, and `parseOpenCodeModel` retain pre-spec behavior?

Evidence: The opencode.ts diff has exactly two hunks — `@@ normalizeOpenCodeUsage` and `@@ opencodeChat`. No hunk touches the four protected function definitions. The `defaultOpenCodePermission`/`normalizeOpenCodePermission` tokens that appear in the diff are the permission call-site **relocated within `opencodeChat`** as part of the licensed SDK-path restructure ([opencode.ts:424-426](src/providers/opencode.ts#L424-L426)), not edits to the definitions. Deny-by-default is preserved in both modes: SDK at [opencode.ts:425](src/providers/opencode.ts#L425), CLI at [opencode.ts:557](src/providers/opencode.ts#L557) → `OPENCODE_PERMISSION` at [opencode.ts:561](src/providers/opencode.ts#L561).

## Violations

None.

## Unverifiable

None.

## Pre-Existing

None.

## Ledger Results

### Phase: opencode-adapter-runtime-fixes

| Invariant | Verdict | Evidence |
| --- | --- | --- |
| INV-1 — Token estimation is gateway-owned; the adapter never estimates inline | PASS | `rg "estimateTokens\|/ 4\|Math.ceil" src/providers/opencode.ts` returned no matches. `normalizeOpenCodeUsage` returns `undefined` on missing `info`/`tokens`/`input`/`output` ([opencode.ts:235-245](src/providers/opencode.ts#L235-L245)), deferring to the gateway's estimation in `normalizeUsage`. |
| INV-2 — The adapter deletes only sessions it created | PASS | The sole `session.delete` call site ([opencode.ts:267](src/providers/opencode.ts#L267)) is inside `deleteOpenCodeSession`, invoked only when `createdSessionId != null` ([opencode.ts:528-529](src/providers/opencode.ts#L528-L529)). `createdSessionId` is set only after an adapter-created session ([opencode.ts:455](src/providers/opencode.ts#L455)); a caller-supplied `sessionId` skips the create branch, leaving it `undefined`, so no delete occurs. |

## Notes

The implementation landed across four commits after the criteria baseline (`4e9c659` usage rewrite, `d350da9` bounded cleanup helper, `cb139f5` SDK-path restructure, `e9d2f72` typed fixtures), matching the spec's four implementation steps one-to-one. All structural and negative constraints the test suite cannot see are satisfied. Acceptance criteria AC-1..AC-12 remain owned by the test suite and the type checker (T register) and were not re-audited here.
