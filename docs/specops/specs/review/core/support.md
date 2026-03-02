# Review: `core/support`

1. Reconcile the `defaultConfig` immutability contract with the implementation steps.
Acceptance criterion 1 says `defaultConfig` is a frozen object, but Step 5 only says to export it as a `const` satisfying `AppConfig`, and the tests only assert field presence and example values. A `const` binding does not freeze nested objects, so the current spec leaves the immutability guarantee unimplemented and untested. The spec should either require an actual deep-freeze strategy and add a test for it, or drop the stronger "frozen object" claim and stick to the analysis-level contract that callers receive a deep-cloned working copy.

2. Move the `PO_ROOT` check ahead of registry hydration in `loadConfig`.
Step 7 says `loadConfig` should hydrate pipelines from `<PO_ROOT>/pipeline-config/registry.json`, then later check whether `PO_ROOT` is set. That ordering is backwards: the registry path cannot be derived safely until `paths.root` is known, and otherwise the implementation must guess between `process.env.PO_ROOT`, `config.paths.root`, or an invalid path. The spec should require `loadConfig` to validate and finalize `paths.root` before any registry-path construction or hydration work begins.

3. Prevent `createJobLogger` and `createTaskLogger` from letting `additionalContext` override the required identifiers.
Step 9 defines `createJobLogger(componentName, jobId, additionalContext?)` as `createLogger(componentName, { jobId, ...additionalContext })`, and similarly for `createTaskLogger`. With that merge order, a caller can accidentally erase or replace the required `jobId` / `taskName` by passing those keys in `additionalContext`, which contradicts the convenience-factory contract in acceptance criteria 42 and 43. The spec should require the explicit identifiers to win, for example by spreading `additionalContext` first and applying `jobId` / `taskName` last.

4. Resolve the contradictory guidance on whether `validatePipeline` should cache its compiled AJV schema.
The Notes section first says the static pipeline schema "should cache the compiled pipeline schema," then immediately says to "preserve the per-call behavior to match the JS implementation exactly." Those directions imply different implementations, performance characteristics, and observable behavior if AJV options or schema objects change over time. The spec should choose one rule explicitly and use it consistently across the Notes, implementation steps, and tests.

5. Clarify the sync/async config parity boundary so the migration does not drift by accident.
The analysis explicitly calls out that `getConfig()` skips schema validation and pipeline path existence checks, while `loadConfig()` performs both. Step 8 preserves that asymmetry in prose, but the acceptance criteria mostly describe one combined configuration contract and do not clearly separate which guarantees belong only to `loadConfig()`. The review should require the acceptance criteria to distinguish async-only guarantees from sync guarantees, otherwise the TypeScript rewrite may accidentally tighten `getConfig()` or weaken `loadConfig()` during implementation.
