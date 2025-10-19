# PR2 Execution Plan — Seed Schema, Validation, and CLI Alignment

## Scope

Make the `pipeline` slug mandatory throughout seed validation and CLI submission flows, leveraging the registry introduced in PR1. Focus on minimal, surgical modifications to existing validators and CLI code.

## Task Sequence

1. **Augment Ajv seed schema**
   - In [`src/core/validation.js`](src/core/validation.js:7), update `getSeedSchema()` to:
     - Add a required `pipeline` property of type `string`.
     - Populate its `enum` with `Object.keys(getConfig().pipelines)` (call `getConfig()` once per schema build).
   - Ensure `required` array includes `"pipeline"`.

2. **Update seed validation tests (Ajv layer)**
   - Extend existing cases in `tests/seed-validators.test.js` (Ajv section) to assert:
     - Missing `pipeline` produces validation failure.
     - Invalid slug not in registry fails with descriptive error.
     - Valid slug passes.

3. **Enhance imperative validator**
   - In [`src/api/validators/seed.js`](src/api/validators/seed.js:96):
     - After `validateRequiredFields`, check for `seedObject.pipeline`.
     - Use `getPipelineConfig(seedObject.pipeline)` (import from `src/core/config.js`) to verify existence; propagate thrown errors or wrap with meaningful messaging.
     - Remove legacy fallback assigning `"default"`.

4. **Update duplicate-check logic**
   - Ensure duplicate checks continue to use job name (no scoping change), but confirm helper receives `seedObject.pipeline` if future logic needs it; document in code comment.

5. **Adapt CLI submit command**
   - In [`src/cli/index.js`](src/cli/index.js:69):
     - Add `--pipeline <slug>` option (required unless seed has pipeline field).
     - When flag provided, override/insert `pipeline` in seed payload before submission.
     - Before calling `submitJobWithValidation`, call `getPipelineConfig(pipeline)` to catch invalid slugs early and show CLI-friendly error.

6. **Adjust CLI init scaffolding**
   - In the `init` command (`src/cli/index.js:16`), ensure templates include `"pipeline": "<slug>"` in generated seed sample or README to guide users.

7. **CLI tests**
   - Update or add tests under `tests/cli.test.js` (and related fixtures) covering:
     - Submission fails without pipeline flag/field.
     - Submission succeeds when flag matches registry.
     - Error message for unknown slug.

8. **Documentation tweaks**
   - Amend relevant docs (README/demo/plan) noting seeds must include `pipeline`, and CLI commands require explicit slug or flagged override.
   - Reference registry helper for validation.

9. **Regression checks**
   - Run targeted test suites (`npm test -- seed-validators cli`) and CLI smoke commands (e.g., `node demo/run-demo.js run <seed>` with updated seeds) to confirm pipeline slug enforcement.

## Deliverables

- Mandatory `pipeline` property enforced by Ajv schema and imperative validator.
- CLI commands requiring or injecting pipeline slug with early validation against registry.
- Updated tests and docs reflecting new requirement.
