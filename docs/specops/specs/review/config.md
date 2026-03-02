# Review: `config`

1. Fix the immutability plan so the exported validation sets cannot be mutated at runtime.
The analysis says this module has no mutable state and that its exported structures are frozen/immutable, but the implementation spec exports `Set<string>` for `VALID_MODEL_ALIASES`, `VALID_LOG_EVENTS`, `VALID_LOG_FILE_EXTENSIONS`, `VALID_TASK_STATES`, `VALID_JOB_STATUSES`, and `VALID_JOB_LOCATIONS`. Those sets remain mutable to any importer via `.add()` / `.delete()`. The spec should require `ReadonlySet<...>` in the public types and an implementation approach that does not expose mutable sets if it wants to preserve the analyzed contract.

2. Require deep immutability for nested registry values, not just `Object.freeze` on the top-level objects.
Acceptance criterion 55 only checks that the outer exported objects are frozen. That still leaves nested `MODEL_CONFIG` entries and `PROVIDER_FUNCTIONS` entry objects mutable unless each entry and provider array is frozen individually. Because the analysis explicitly describes these registries as immutable for the process lifetime, the spec should state the deep-freeze requirement and test the nested values, not only the container objects.

3. Preserve or explicitly document the invalid-`location` path behavior instead of silently tightening the API.
The analysis records that `getJobDirectoryPath` currently accepts an invalid `location` and produces a path containing `"undefined"`. The implementation spec narrows the parameter to `JobLocationValue`, which is a reasonable TypeScript improvement, but it is still a behavioral and API change for dynamic callers and plain JS consumers. The spec should either require the runtime behavior to remain compatible for invalid strings or mark this as an intentional breaking change rather than treating it as a transparent migration.

4. Add a concrete test strategy for the module-load invariant failures.
Acceptance criteria 28 through 30 require import-time throws for provider mismatches, negative pricing, and alias-set drift, but the test plan only covers successful imports and happy-path helpers. Without an isolated-module import strategy, a test-only factory, or a documented pattern for re-evaluating the module with bad fixture data, those failure criteria are not actually implementable or verifiable. The spec should define how those invariant checks will be tested before implementation starts.

5. Tighten the type design around providers and aliases so the exact catalog contract is enforced at compile time.
The proposed interfaces use broad `string` keys and values for `provider`, alias maps, and `DEFAULT_MODEL_BY_PROVIDER`, even though the same spec says the module has exactly 35 aliases and 7 providers. That looseness allows misspelled providers, mismatched defaults, and incomplete coverage to compile, leaving correctness to runtime checks only. The spec should derive provider and alias literal unions from the source constants and use them in `MODEL_CONFIG`, `DEFAULT_MODEL_BY_PROVIDER`, `FUNCTION_NAME_BY_ALIAS`, and `PROVIDER_FUNCTIONS` so the TypeScript migration actually captures the fixed registry shape described by the analysis.
