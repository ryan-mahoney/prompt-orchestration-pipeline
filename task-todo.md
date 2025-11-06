# Centralize Config Implementation Todo List

## Phase 1: Core Module Creation

- [x] Create src/config/statuses.js with canonical constants and utilities

## Phase 2: Replace Status Transformers

- [x] Update src/ui/transformers/status-transformer.js to use centralized module
- [x] Update src/ui/client/adapters/job-adapter.js to use centralized module

## Phase 3: Unify Config Bridges

- [x] Update src/ui/config-bridge.js
- [x] Update src/ui/config-bridge.node.js
- [x] Update src/ui/config-bridge.browser.js

## Phase 4: Normalize Duration Utilities

- [x] Update src/utils/duration.js to use canonical tokens

## Phase 5: Update UI Components

- [x] Update src/components/DAGGrid.jsx (remove "succeeded")
- [x] Update src/components/JobTable.jsx (remove "completed")
- [x] Update src/pages/PromptPipelineDashboard.jsx (canonical tokens)
- [x] Update src/utils/ui.jsx
- [x] Update src/core/task-runner.js

## Phase 6: Replace Raw String Comparisons

- [x] Update src/core/status-writer.js
- [x] Update src/utils/dag.js
- [x] Update src/core/pipeline-runner.js

## Phase 7: Test Updates

- [ ] Update tests for canonical tokens (completed -> complete, error -> failed, succeeded -> done)

## Phase 8: Validation

- [x] Run linter to check for remaining non-canonical strings
- [ ] Verify imports and tree-shaking work correctly
