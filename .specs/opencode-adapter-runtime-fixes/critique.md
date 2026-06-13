# Architecture Critique: OpenCode Adapter Runtime Correctness Fixes

> Reviewing: `.specs/opencode-adapter-runtime-fixes/proposal.md`
> Date: 2026-06-13

## Proposal Summary

The proposal fixes three runtime defects in the `opencode` provider adapter that the mock-based test suite hides: token usage read from flat fields that the SDK never emits (real shape is nested `tokens: { input, output }`), an abort signal placed in the wrong argument position so `requestTimeoutMs` never cancels, and a session created per call that is never deleted. The fixes are scoped to `src/providers/opencode.ts` and its tests, with the shared-`ChatOptions` smell explicitly deferred.

## Expert Perspectives

### Michael Nygård — Integration Points Are Where Systems Die

**Relevant background:** Author of *Release It!*, the canonical text on production stability patterns at the exact boundary this proposal touches — calls to external systems.

**Grounding source:** *Release It! Design and Deploy Production-Ready Software*, 2nd ed. (Pragmatic Bookshelf, 2018) — Stability Antipatterns (Integration Points, Blocked Threads, Slow Responses) and Stability Patterns (Timeouts, Circuit Breaker, Bulkheads, Fail Fast).

**Would challenge:**

- **The cleanup path is unbounded.** The proposal puts `session.delete` in a `finally` and says to "swallow/log cleanup errors," but never bounds the delete call itself. Nygård's central point: when an integration point fails, it usually fails by being *slow*, not by returning an error. If the OpenCode server is the thing that's down, the cleanup `delete` will hang exactly like the original prompt did. You would be fixing a missing timeout in the request path and reintroducing the same Blocked Threads antipattern in the cleanup path. The cleanup call needs its own short timeout.
- **A corrected timeout is necessary but not sufficient.** The proposal notes a stuck connection holds a `parallel()` slot, then stops at "correct cancellation." Nygård would press on Slow Responses: when OpenCode is degraded-but-alive, every prompt now correctly times out — but only after `requestTimeoutMs`, and they pile up. Without a bulkhead or fail-fast around the integration point, a slow server still drags down every pipeline stage for the full timeout window each time.
- **Session create/destroy per call is connection churn.** *Release It!* favors pooling and capacity limits for expensive resources. The proposal rejects pooling on repeatability grounds (Alternative B). Nygård would accept that tradeoff for a deterministic orchestrator but object to calling the churn cost negligible without measuring it.

**Would approve:**

- Adding the timeout at all — "every integration point gets a timeout" is his rule.
- Cleanup in `finally`, never deleting a caller-supplied session, and preserving the original error over the cleanup error (Fail Fast, correct resource ownership).
- Refusing to expand surface area — less new code at the integration point is less new instability.

**Key question they'd ask:**

> "When the OpenCode server is slow rather than down, what stops a backlog of prompts — each now correctly timing out — from occupying every `parallel()` slot for `requestTimeoutMs` at a stretch? And does your cleanup `delete` have its own timeout, or did you just move the hang downstream?"

---

### Charity Majors — Telemetry That Lies Is Worse Than Silence

**Relevant background:** Co-author of *Observability Engineering*; long-running advocate that instrumentation is a first-class deliverable and that mocks give false confidence. Defect 1 is a telemetry-correctness bug and the root cause is a mock asserting a fictional shape — squarely her territory.

**Grounding source:** *Observability Engineering: Achieving Production Excellence* (O'Reilly, 2022, Majors / Fong-Jones / Miranda); honeycomb.io and charity.wtf writing on high-fidelity instrumentation and testing against real systems.

**Would challenge:**

- **"Imprecise" undersells it — the system emits confident wrong numbers.** Estimated char/4 tokens presented through `llm:request:complete` as if measured is the dashboards-that-lie failure she rails against. She'd approve the field-mapping fix but push further: nothing in the telemetry distinguishes *measured* from *estimated* usage — not for OpenCode and not for any other provider that falls back to estimation. The fix corrects one provider and leaves the systemic lie. Add usage provenance to the event.
- **Mocks are why this bug existed; fixing the fixture by hand doesn't close the gap.** Her recurring position: mocks drift from reality. Hand-editing one fixture to match `types.gen.d.ts` today does nothing to stop the next drift. The guard must be structural — derive the fixture from the SDK's generated type so it cannot compile when the shape changes — or exercise the real contract. The proposal gestures at "source fixtures from `AssistantMessage`"; she'd want that enforceable, not aspirational.
- **The unenforced timeout is also an observability hole.** A request that never cancels emits no error event, no duration — it is invisible. She'd frame the timeout fix as restoring a failure *signal*, not just liveness, and want the test to assert the error event fires, not merely that the call aborts.

**Would approve:**

- Correcting token mapping — accurate, high-cardinality instrumentation is the whole point.
- Asserting exact counts, not just presence — tests should defend the values operators actually read.
- Restoring the cancellation path so timeouts produce observable events.

**Key question they'd ask:**

> "After this fix, can an operator looking at a single `llm:request:complete` event tell whether the token counts were measured by the provider or estimated by POP? If not, you fixed one provider and left the lie in place for every other one."

---

## Synthesis

### Where Both Experts Agree

- **The unenforced timeout is the top issue** — Nygård via stability (a hung call blocks a worker), Majors via observability (a hung call emits nothing). Highest-confidence must-fix, and both want the assertion to prove cancellation actually happens.
- **The cleanup path must be bounded.** Nygård says it explicitly; Majors' "invisible hang" logic reaches the same place. An unbounded `session.delete` in `finally` is the same defect relocated.
- **Mock-based tests are not a durable guard.** The bug is a contract-fidelity failure. Both would distrust a fix that re-mocks the same boundary without making the real shape enforceable.

### Where They Diverge

Nygård wants *more* defensive machinery at the integration point — circuit breaker, bulkhead, bounded everything. Majors resists complexity POP can't debug and would rather invest in honest instrumentation and real-contract tests than in failure-handling scaffolding.

Resolved against this project's context: POP is a single-node, file-based orchestrator with bounded `parallel()` concurrency that attaches to a user-managed `opencode serve` — not an HA fleet. A full circuit breaker is over-engineering for phase 1 (side with Majors). But a bounded cleanup timeout and an explicit note about slot exhaustion are cheap and correct (side with Nygård on those two specifics). Take the low-cost half of Nygård's hardening, decline the heavyweight half.

### Blind Spots

- **Usage provenance is a gateway problem, not an OpenCode problem.** The measured-vs-estimated ambiguity lives in `normalizeUsage` in `src/llm/index.ts` and affects every provider. Neither expert's lens centers it because it sits one layer above the adapter.
- **The retry/session-lifecycle restructure is the riskiest part of the diff.** The proposal correctly notes that session creation must bracket the *whole* retry loop (so a retry doesn't delete the session it still needs), but that is a control-flow change, not a one-liner. Introducing a new bug here is the real implementation risk, and it is a code-structure concern outside both experts' domains.
- **Removing the `as unknown` casts is itself a guard.** The proposal's instinct to type the `session.prompt` call properly means a future SDK signature change becomes a compile error. Worth stating as an explicit benefit, not a side effect.

## Recommendations

### Must Address

1. **Bound the cleanup delete.** Give `session.delete` its own short, independent timeout (or abort signal). An unbounded delete in `finally` reintroduces the exact hang the proposal is fixing, in the cleanup path, precisely when the server is the thing that is down.
2. **Prove cancellation is observable.** Keep the signal-placement fix, and add a test asserting a timed-out SDK prompt emits `llm:request:error` (via the gateway) — not just that `prompt` received a signal. A timeout that aborts but emits nothing is still a blind spot.
3. **Make the real-shape fixture structural.** Derive the test `AssistantMessage` fixture from the SDK's generated type (a typed `const` checked against `import("@opencode-ai/sdk/v2").AssistantMessage`, or equivalent) so the test fails to compile if `tokens`/`structured` drift. The bug was a contract-fidelity failure; fix it at that level, not by re-hand-editing one object.

### Should Address

1. **Add usage provenance to telemetry.** Mark each `llm:request:complete` (or the `NormalizedUsage`) as measured vs. estimated, at the `normalizeUsage` gateway layer. OpenCode is not the only provider that falls back. If out of scope here, file it explicitly rather than leaving the lie undocumented.
2. **Specify the retry/session-lifecycle restructure precisely** and land the "exactly one `create`, exactly one `delete` across a retried call" test the proposal already names. This is the highest-risk control-flow change in the diff and deserves the most explicit spec.

### Consider

1. **Document the slot-exhaustion limit.** Under a slow OpenCode server, correctly-timing-out prompts still hold `parallel()` slots for `requestTimeoutMs`. No code change now — just make the operating boundary explicit so it is a known limit, not a surprise.
2. **Measure session churn before permanently rejecting pooling.** The decision to create/delete per call is reasonable for determinism; the "negligible cost" assumption is untested. A one-time measurement against a real server settles it.

## Revised Confidence

**Strong with minor adjustments.** The three defects are real, correctly diagnosed against the actual `@opencode-ai/sdk@1.17.4` generated types, and the fixes are sound in direction. The gaps are all at edges the proposal left slightly open: the cleanup path's own failure mode, telemetry provenance across providers, and making the test guard structural rather than manual. None of these require re-architecture; they tighten an already-correct plan.
