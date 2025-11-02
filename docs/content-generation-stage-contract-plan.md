# Content Generation Stage Contract Update Plan

## Objective

Ensure every stage handler in [tasks/index.js](demo/pipeline-config/content-generation/tasks/index.js) conforms to [assertStageResult](src/core/task-runner.js:37) by returning an object with `output` and `flags` (plain object). Scope limited to contract compliance.

## Current Stage Handler Compliance

### Research task

- ✅ [research.ingestion()](demo/pipeline-config/content-generation/tasks/research.js:4) already returns `{ output, flags }`.
- ⚠️ [research.promptTemplating()](demo/pipeline-config/content-generation/tasks/research.js:67) returns only `output`; needs `flags: {}`.
- ⚠️ [research.inference()](demo/pipeline-config/content-generation/tasks/research.js:97) writes artifacts without returning; needs to return prior `output` plus empty `flags`.
- ✅ [research.validateStructure()](demo/pipeline-config/content-generation/tasks/research.js:128) already returns validation flags.
- ⚠️ [research.integration()](demo/pipeline-config/content-generation/tasks/research.js:176) returns only `output`; needs `flags: {}`.

### Analysis task

- ⚠️ [analysis.promptTemplating()](demo/pipeline-config/content-generation/tasks/analysis.js:3) returns only `output`; needs `flags: {}`.
- ⚠️ [analysis.inference()](demo/pipeline-config/content-generation/tasks/analysis.js:38) returns `output` without `flags`.
- ✅ [analysis.validateStructure()](demo/pipeline-config/content-generation/tasks/analysis.js:77) already returns validation flags.
- ⚠️ [analysis.integration()](demo/pipeline-config/content-generation/tasks/analysis.js:133) returns only `output`; needs `flags: {}`.

### Synthesis task

- ⚠️ [synthesis.ingestion()](demo/pipeline-config/content-generation/tasks/synthesis.js:3) returns only `output`; needs `flags: {}`.
- ⚠️ [synthesis.promptTemplating()](demo/pipeline-config/content-generation/tasks/synthesis.js:32) returns only `output`; needs `flags: {}`.
- ⚠️ [synthesis.inference()](demo/pipeline-config/content-generation/tasks/synthesis.js:65) returns only `output`; needs `flags: {}`.
- ⚠️ [synthesis.integration()](demo/pipeline-config/content-generation/tasks/synthesis.js:112) returns only `output`; needs `flags: {}`.

### Formatting task

- ⚠️ [formatting.ingestion()](demo/pipeline-config/content-generation/tasks/formatting.js:3) returns only `output`; needs `flags: {}`.
- ⚠️ [formatting.preProcessing()](demo/pipeline-config/content-generation/tasks/formatting.js:32) returns only `output`; needs `flags: {}`.
- ⚠️ [formatting.promptTemplating()](demo/pipeline-config/content-generation/tasks/formatting.js:78) returns only `output`; needs `flags: {}`.
- ⚠️ [formatting.inference()](demo/pipeline-config/content-generation/tasks/formatting.js:111) returns only `output`; needs `flags: {}`.
- ⚠️ [formatting.finalValidation()](demo/pipeline-config/content-generation/tasks/formatting.js:156) should mirror validation contract by returning validation metadata in `output` and flags such as `validationFailed` and `lastValidationError`.
- ⚠️ [formatting.integration()](demo/pipeline-config/content-generation/tasks/formatting.js:192) returns only `output`; needs `flags: {}`.

## Update Strategy

1. Add explicit `return { output: ..., flags: {} }` to each stage currently omitting flags, preserving existing `output` payloads and side effects.
2. For stages without meaningful produced data (e.g., [research.inference()](demo/pipeline-config/content-generation/tasks/research.js:97)), return the prior `context.output` alongside empty flags to satisfy the contract without altering behavior.
3. Align [formatting.finalValidation()](demo/pipeline-config/content-generation/tasks/formatting.js:156) with validation conventions by returning a validation summary in `output` and exposing `validationFailed` and `lastValidationError` via flags.
4. Keep flag handling minimal (empty objects unless validation state already exists) to limit scope to contract compliance.

## Validation and Testing

- Execute [tests/task-runner.test.js](tests/task-runner.test.js) and [tests/task-runner-missing-stages.test.js](tests/task-runner-missing-stages.test.js) to confirm stage execution compatibility.
- Run [tests/content-pipeline-integration.test.js](tests/content-pipeline-integration.test.js) to validate content-generation pipeline behavior under the new contract.
- Optionally run project linting to catch regressions once implementation completes.

## Workflow Overview

```mermaid
flowchart LR
  Seed --> Research
  Research --> Analysis
  Analysis --> Synthesis
  Synthesis --> Formatting
  Formatting --> Final
```
