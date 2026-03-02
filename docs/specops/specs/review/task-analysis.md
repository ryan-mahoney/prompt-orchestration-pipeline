# Review: `task-analysis`

1. Restore the `DeducedSchema.example` contract to the analyzed object shape instead of weakening it to `unknown`.
The analysis spec defines `deduceArtifactSchema` as returning an object example, but the implementation spec changes that to `example: unknown` and only requires `writeSchemaFiles` to accept any non-null value. That is a silent public-API drift at a persistence boundary. The spec should either keep `example` as an object everywhere or explicitly justify and test the widened contract.

2. Make the artifact-resolver `chat()` contract explicit before changing both `responseFormat` and response parsing behavior.
The implementation spec intentionally changes `resolveArtifactReference` from `"json_object"` to `{ type: "json_object" }`, while also saying to parse `response.content` only if it is a string. The providers analysis says the shared `chat()` gateway already normalizes JSON-mode responses, so this boundary is more specific than the current task-analysis spec admits. The review should require one exact contract for `response.content` in this path and a test that locks it down, otherwise the migration can drift from current behavior without noticing.

3. Reconcile the “nothing is silently dropped” acceptance criterion with the narrower LLM-call syntax the spec actually implements.
Acceptance criterion 4 says every `llm.*.*` call is represented, but the concrete criteria only cover direct calls plus two destructuring patterns. There is no unresolved `ModelCall` shape analogous to unresolved artifacts, so broader or more indirect LLM access patterns would still be silently skipped. The spec should either narrow the top-level claim to the supported syntax forms or add an explicit fallback/error contract for unsupported LLM-call shapes.

4. Add a compatibility requirement for the Babel import interop change instead of treating it as a safe assumption.
The analysis calls out the existing `_traverse.default ?? _traverse` and generator fallback as deliberate CJS/ESM compatibility handling, but the implementation spec removes that behavior without any acceptance criterion or test proving Bun will load these packages the same way in this repo. That makes a runtime-only failure plausible. The spec should either preserve the compatibility shim or add a concrete test/criterion that validates the intended import form under Bun.

5. Tighten the artifact-resolution result validation, especially for `confidence`.
The analyzed contract says `confidence` is a 0.0-to-1.0 score, but the implementation spec only types it as `number` and sanitizes it when the filename is not in `availableArtifacts`. That still allows malformed LLM payloads like `NaN`, `-1`, or `7` to escape as successful results. The spec should require `confidence` to be finite and clamped or rejected outside `[0, 1]`, and it should add a malformed-response test for that path.
