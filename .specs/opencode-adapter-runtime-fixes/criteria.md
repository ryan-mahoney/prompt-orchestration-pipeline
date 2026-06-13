# Conformance Criteria: OpenCode Adapter Runtime Correctness Fixes

- Spec source: `.specs/opencode-adapter-runtime-fixes/spec.md`
- Phase: single (no phase marker)
- Baseline commit: `7f3f0810f1e2ba80522069302fdb42aef594fab0`
- Blindness: compiled blind from spec artifacts (`spec.md`, `proposal.md`, `critique.md`) only; no implementation written for this spec was read. The current `src/providers/opencode.ts` (the file this spec modifies) was treated as precedent for diff targets, not read for these checks.
- Mode counts: T=12, G=4, S=5, D=0, X=2 (appended to `invariants.md`)
- Audit diff target: `git diff 7f3f0810f1e2ba80522069302fdb42aef594fab0...HEAD`

The acceptance criteria (AC-1..AC-12) are pinned by tests and the type checker; they live in the T register and are not re-audited here. The criteria below capture the structural, negative, and scope constraints that a passing test suite cannot see.

---

### C-1 (G) — change scope limited to the allowed source files

Source: §4 Architecture — "No changes to `src/llm/index.ts` dispatch, `src/providers/types.ts`, `src/config/models.ts`, permission defaults, availability checks, or docs."

Check: `git diff --name-only 7f3f0810f1e2ba80522069302fdb42aef594fab0...HEAD -- src/`

Expect: every path is one of `src/providers/opencode.ts`, `src/providers/__tests__/opencode.test.ts`, `src/llm/__tests__/index.test.ts`. No other `src/` file appears.

Violation means: the fix leaked into the gateway, shared types, model registry, or another provider — scope creep beyond an adapter correctness fix.

---

### C-2 (G) — no new dependency added

Source: §4 Dependency Map — "No new external dependency; `session.delete` is on the existing typed client."

Check: `git diff 7f3f0810f1e2ba80522069302fdb42aef594fab0...HEAD -- package.json bun.lock`

Expect: no additions under `dependencies` / `devDependencies` in `package.json` and no new package added to `bun.lock`.

Violation means: a dependency was introduced to satisfy a fix the spec says uses only the already-installed `@opencode-ai/sdk`.

---

### C-3 (G) — no `as unknown` cast on the `session.prompt` call

Source: §4 Design Decisions — "Drop the `as unknown` casts on the prompt call"; §7 Step 3 — "remove the `as unknown` casts by typing against the SDK."

Check: `rg -n "as unknown" src/providers/opencode.ts`

Expect: no `as unknown` cast applied to the `session.prompt` parameters or options arguments. (Any surviving `as unknown` elsewhere must be justified and unrelated to the prompt call; the prompt call must be plainly typed.)

Violation means: the prompt call still launders argument shapes through `as unknown`, so a future SDK signature change stays silent instead of failing compilation.

---

### C-4 (G) — no circuit breaker / bulkhead machinery added

Source: §6 Notes — "Deferred — circuit breaker / bulkhead ... the heavyweight half is declined."

Check: `rg -ni "circuit|breaker|bulkhead" src/providers/opencode.ts`

Expect: no matches.

Violation means: the deferred stability scaffolding was implemented here, exceeding the spec's scope.

---

### C-5 (S) — missing-base-URL error is thrown before the retry loop

Source: §4 control-flow — "throw the missing-base-URL error before the retry loop (fail fast)"; §7 Step 3.

Read: `src/providers/opencode.ts` (`opencodeChat`).

Question: In SDK mode, is the `baseUrl == null` check (and its throw) evaluated once before the `for (attempt …)` retry loop, rather than inside the loop body?

Violation means: the fail-fast guard runs inside the retry loop, so an unconfigured base URL is retried instead of failing immediately.

---

### C-6 (S) — the SDK client is created once above the retry loop

Source: §4 control-flow — "client = createOpencodeClient({ baseUrl }) // hoisted, created once"; §7 Step 3 — "create the client once above the loop."

Read: `src/providers/opencode.ts` (`opencodeChat`).

Question: Is `createOpencodeClient` called exactly once per `opencodeChat` invocation, above/outside the retry loop — not once per attempt inside it?

Violation means: a new client is built on every retry, and the `finally` cleanup has no stable client reference to delete the created session.

---

### C-7 (S) — fresh session per call; no module-level session pool

Source: §4 Design Decisions — "Delete-after-use, not pooling. Preserves the phase-1 'fresh session per request' repeatability guarantee."

Read: `src/providers/opencode.ts`.

Question: Does the adapter create a fresh session per call (or reuse only a caller-supplied `opencode.sessionId`), with no module-level/global session cache, pool, or reuse map persisting sessions across calls?

Violation means: sessions are pooled/reused across unrelated calls, breaking the repeatability guarantee and the delete-after-use lifecycle.

---

### C-8 (S) — no measured-vs-estimated usage provenance field added

Source: §6 Notes — "Deferred — usage provenance across providers ... deferred to a separate change."

Read: `src/providers/opencode.ts`, and confirm `src/providers/types.ts` and `src/llm/index.ts` are unchanged (per C-1).

Question: Does this change add no `provenance` / `estimated` / `measured` flag to `AdapterUsage`, `NormalizedUsage`, or the `llm:request:complete` event?

Violation means: the deferred gateway-wide provenance feature was smuggled into this adapter fix.

---

### C-9 (S) — permission defaults and availability checks are untouched

Source: §4 Architecture — "No changes to ... permission defaults, availability checks."

Read: `git diff 7f3f0810f1e2ba80522069302fdb42aef594fab0...HEAD -- src/providers/opencode.ts`.

Question: Do `defaultOpenCodePermission`, `normalizeOpenCodePermission`, `isOpenCodeAvailable`, and `parseOpenCodeModel` retain their pre-spec behavior (no edits to their bodies)?

Violation means: the runtime fix altered the safe-by-default permission or non-interactive availability behavior established by the parent OpenCode spec.

---

## T Register (tested — owned by CI, not re-audited)

| AC | Statement | Pinned by |
| --- | --- | --- |
| AC-1 | `normalizeOpenCodeUsage` maps `info.tokens.input/output` → `prompt_tokens/completion_tokens` (+ derived total) | Step 1 unit test |
| AC-2 | `total_tokens` uses `info.tokens.total` when numeric, else `input + output` | Step 1 unit test |
| AC-3 | Returns `undefined` when `info` / `tokens` / `input` / `output` missing or non-numeric | Step 1 unit test |
| AC-4 | Real-shaped response yields measured `AdapterResponse.usage`; gateway `complete` carries measured counts | Step 3 adapter + `index.test.ts` |
| AC-5 | `session.prompt` receives the signal in its second (options) arg; parameters carry no `signal` | Step 3 adapter test |
| AC-6 | Unsettled prompt aborts after `requestTimeoutMs` and `opencodeChat` rejects | Step 3 adapter test |
| AC-7 | Adapter-created session is deleted after a successful prompt | Step 3 adapter test |
| AC-8 | Adapter-created session is deleted even when the prompt throws | Step 3 adapter test |
| AC-9 | Caller-supplied `opencode.sessionId` is never deleted | Step 3 adapter test |
| AC-10 | `deleteOpenCodeSession` is bounded by its own timeout; its failure does not propagate | Step 2 adapter test |
| AC-11 | Across a retried call, `session.create` once and `session.delete` once | Step 3 adapter test |
| AC-12 | SDK fixtures are typed against `AssistantMessage`; shape drift breaks compilation | Type checker (Step 4) |

---

## Invariants Appended

See `.specs/opencode-adapter-runtime-fixes/invariants.md`:

- INV-1 — Token estimation is gateway-owned; the OpenCode adapter never estimates inline.
- INV-2 — The adapter deletes only sessions it created; caller-supplied sessions are never deleted by the adapter.
