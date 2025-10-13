Goal
Make the repository use one canonical pipeline config format: tasks is an ordered array of string task names, and per-task settings live in a top-level taskConfig object keyed by task name. Apply code changes, tests, demo files, and docs so the system, demo, and documentation are consistent.

Acceptance criteria (testable)

1. pipeline.json uses "tasks": ["a","b",...] and "taskConfig": { "a": {...}, "b": {...} }.
2. The orchestrator + pipeline-runner read pipeline.json and do not throw ERR_INVALID_ARG_TYPE.
3. A validation step fails fast when pipeline.json uses object-style tasks (old format).
4. Demo runs without runtime errors and the demo tasks read config from ctx.taskConfig.
5. Tests pass (run: npm -s test).

Numbered step-by-step plan (each step is a testable unit)

1. Add a short spec header (documentation)
   - File: docs/tasks-data-shape.md (or update if already present)
   - Action: Insert the canonical JSON example and a brief rule:
     - tasks must be an array of strings (ordered)
     - taskConfig must be an object mapping taskName -> config object
   - Test: Open demo/pipeline-config/pipeline.json and confirm it matches the example.

2. Update demo pipeline config to canonical format
   - File: demo/pipeline-config/pipeline.json
   - Action: Replace object-style entries in "tasks" with string array; move per-task "config" objects under "taskConfig" keyed by the task id/name.
   - Example (before):
     - "tasks": [{ "id": "research", "name": "research", "config": { ... } }, ...]
   - Example (after):
     - "tasks": ["research","analysis","synthesis","formatting"]
     - "taskConfig": { "research": { ... }, ... }
   - Test: Run a JSON validator or jq to assert pipeline.json.tasks is an array of strings and taskConfig has keys matching tasks.

3. Add pipeline config schema & validation function
   - Files to create/modify:
     - src/core/validation.js — add functions validatePipeline(pipeline) and validatePipelineOrThrow(pipeline)
     - config.schema.json — add/update schema for pipeline file (tasks: array of strings; taskConfig: object with properties allowed)
   - Action:
     - Implement a small Ajv schema for pipeline.json:
       - type: object
       - required: [ "name", "tasks" ]
       - tasks: { type: "array", items: { type: "string" }, minItems: 1 }
       - taskConfig: { type: "object", additionalProperties: { type: "object" } }
     - Implement validatePipeline(pipeline) to compile & return { valid, errors }
     - Implement validatePipelineOrThrow(pipelinePath) to read file, run validation, and throw a descriptive Error if invalid.
   - Test:
     - Write a unit test tests/pipeline-config-validation.test.js:
       - Should pass when given canonical pipeline.json
       - Should fail with clear error when given object-style tasks (supply a small sample JSON string)

4. Call validation early in pipeline-runner
   - File: src/core/pipeline-runner.js
   - Action:
     - After reading PIPELINE_DEF_PATH and parsing pipeline, call validatePipelineOrThrow(pipeline) (or validatePipelineOrThrow(PIPELINE_DEF_PATH)).
     - If validation fails, emit a clear message and exit (throw).
   - Test:
     - Run node src/core/pipeline-runner.js <name> with demo pipeline.json path set; ensure runner starts when format is correct.
     - Make a temporary invalid pipeline.json (object-style tasks) and assert the runner throws with your validation message instead of Node's ERR_INVALID_ARG_TYPE.

5. Sweep and update code to expect canonical format (minimal changes)
   - Files to verify and update as necessary:
     - src/core/pipeline-runner.js — the existing code already assumes taskName is a string; after step 4 this will be enforced. Ensure you use pipeline.taskConfig?.[taskName] for per-task config.
     - src/core/orchestrator.js — no change required for format but ensure demo runner env PO_PIPELINE_PATH points to changed pipeline.json (it already does).
     - demo pipeline task modules (demo/pipeline-config/tasks/\*/index.js) — they already use context.taskConfig?.property; confirm nothing else expects object-style tasks.
   - Test:
     - Run the orchestrator + runner (demo/run-demo.js) and confirm tasks execute and write artifacts.

6. Update tests & fixtures
   - Files to update:
     - tests/orchestrator.test.js, tests/e2e-upload.test.js, any test fixture that uses object-style task entries.
   - Action:
     - Replace object-style tasks in test fixtures with canonical string-array + taskConfig mapping.
     - Add or update tests to assert that pipeline-runner injects taskConfig into ctx.taskConfig correctly.
   - Test:
     - Run the full test suite: npm -s test (or npm test). Fix any failing tests that relied on the old shape.

7. Add a migration note and examples in docs
   - Files to update:
     - demo/README.md
     - docs/project-seed-upload.md (if it references pipeline.json)
     - docs/tasks-data-shape.md (created/updated in step 1)
   - Action:
     - Add a short migration section explaining how to convert object-style task entries into canonical format with before/after snippets.
   - Test:
     - Manually verify examples render correctly and match demo/pipeline-config/pipeline.json.

8. Add an automated check (optional but recommended)
   - Files to modify:
     - src/cli/index.js or a small script scripts/validate-pipeline.js
   - Action:
     - Add a CLI command script that validates a pipeline file: `node scripts/validate-pipeline.js demo/pipeline-config/pipeline.json`
   - Test:
     - Run the script against demo pipeline and an intentionally broken pipeline to verify it prints success/failure and non-zero exit code for invalid files.

9. Run manual demo & smoke tests
   - Commands:
     - npm -s test
     - node demo/run-demo.js (or the documented demo steps)
   - Expected results:
     - No ERR_INVALID_ARG_TYPE occurrences.
     - Orchestrator moves seed files into current/<name>/seed.json and runner writes tasks/<task>/output.json.

10. Commit changes & follow repo conventions

- Commit message format:
  - feat(core): enforce canonical pipeline.json format and validate pipeline files
- Files to include in commit:
  - src/core/validation.js (new/modified)
  - src/core/pipeline-runner.js (validation call)
  - demo/pipeline-config/pipeline.json (updated)
  - config.schema.json (updated)
  - tests/\* (updated fixtures + new validation tests)
  - docs/tasks-data-shape.md (new/updated)
  - scripts/validate-pipeline.js (optional)
- Test:
  - Run commitlint workflow locally if configured; ensure tests pass pre-commit.

Implementation notes / code snippets (copy-paste ready)

- Minimal Ajv schema (put in src/core/validation.js or config.schema.json):
  {
  type: "object",
  required: ["name", "tasks"],
  properties: {
  name: { type: "string" },
  tasks: {
  type: "array",
  items: { type: "string" },
  minItems: 1
  },
  taskConfig: {
  type: "object",
  additionalProperties: { type: "object" }
  }
  },
  additionalProperties: true
  }

- pipeline-runner.js (after pipeline is parsed)
  import { validatePipelineOrThrow } from "./validation.js";
  validatePipelineOrThrow(pipeline, PIPELINE_DEF_PATH);

- Example pipeline.json (canonical)
  {
  "name": "demo-pipeline",
  "version": "1.0.0",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "taskConfig": {
  "research": { "model": "gpt-5-nano", "temperature": 0.7, "maxTokens": 2000 },
  "analysis": { "model": "gpt-5-nano", "temperature": 0.6, "maxTokens": 2500 },
  "synthesis": { "model": "gpt-5-nano", "temperature": 0.8, "maxTokens": 3000 },
  "formatting": { "model": "gpt-5-nano", "temperature": 0.3, "maxTokens": 2000 }
  }
  }

Checklist (mark when each step is done)

- [ ] 1. Update docs/tasks-data-shape.md with canonical spec
- [ ] 2. Update demo/pipeline-config/pipeline.json to string-array + taskConfig
- [ ] 3. Implement validatePipeline / add schema
- [ ] 4. Invoke validation in src/core/pipeline-runner.js
- [ ] 5. Verify code paths expect canonical format (minimal sweep)
- [ ] 6. Update tests & fixtures
- [ ] 7. Update docs and add migration note
- [ ] 8. Add optional CLI validation script
- [ ] 9. Run manual demo & test suite
- [ ] 10. Commit using Conventional Commit
