# SpecOps Analysis Orchestration

This document defines the execution plan for Phase 2 (Discovery & Specification Generation) of the JS → TS migration. Each step invokes the analysis prompt (`docs/specops/prompts/analysis-prompt.md`) with the module variables filled in for a specific subsystem.

Execute each step by providing the analysis prompt with the **MODULE_NAME** and **SOURCE_FILES** listed below. Each step produces one spec document in `docs/specops/specs/analysis/`.

---

## Core Subsystem

### 1. Orchestrator

- **MODULE_NAME:** `core/orchestrator`
- **OUTPUT:** `docs/specops/specs/analysis/core/orchestrator.md`
- **SOURCE_FILES:**
  - `src/core/orchestrator.js`

### 2. Pipeline Runner

- **MODULE_NAME:** `core/pipeline-runner`
- **OUTPUT:** `docs/specops/specs/analysis/core/pipeline-runner.md`
- **SOURCE_FILES:**
  - `src/core/pipeline-runner.js`

### 3. Task Runner

- **MODULE_NAME:** `core/task-runner`
- **OUTPUT:** `docs/specops/specs/analysis/core/task-runner.md`
- **SOURCE_FILES:**
  - `src/core/task-runner.js`
  - `src/core/lifecycle-policy.js`
  - `src/core/progress.js`

### 4. File I/O

- **MODULE_NAME:** `core/file-io`
- **OUTPUT:** `docs/specops/specs/analysis/core/file-io.md`
- **SOURCE_FILES:**
  - `src/core/file-io.js`
  - `src/core/symlink-bridge.js`
  - `src/core/symlink-utils.js`

### 5. Batch Runner

- **MODULE_NAME:** `core/batch-runner`
- **OUTPUT:** `docs/specops/specs/analysis/core/batch-runner.md`
- **SOURCE_FILES:**
  - `src/core/batch-runner.js`

### 6. Status Writer

- **MODULE_NAME:** `core/status-writer`
- **OUTPUT:** `docs/specops/specs/analysis/core/status-writer.md`
- **SOURCE_FILES:**
  - `src/core/status-writer.js`
  - `src/core/status-initializer.js`

### 7. Core Support Modules

- **MODULE_NAME:** `core/support`
- **OUTPUT:** `docs/specops/specs/analysis/core/support.md`
- **SOURCE_FILES:**
  - `src/core/config.js`
  - `src/core/environment.js`
  - `src/core/logger.js`
  - `src/core/module-loader.js`
  - `src/core/validation.js`
  - `src/core/retry.js`

---

## UI Subsystem

### 8. UI Server

- **MODULE_NAME:** `ui/server`
- **OUTPUT:** `docs/specops/specs/analysis/ui/ui-server.md`
- **SOURCE_FILES:**
  - `src/ui/server.js`
  - `src/ui/express-app.js`
  - `src/ui/sse.js`
  - `src/ui/sse-broadcast.js`
  - `src/ui/sse-enhancer.js`
  - `src/ui/file-reader.js`
  - `src/ui/job-reader.js`
  - `src/ui/job-index.js`
  - `src/ui/job-scanner.js`
  - `src/ui/embedded-assets.js`
  - `src/ui/zip-utils.js`
  - `src/ui/config-bridge.js`
  - `src/ui/config-bridge.node.js`
  - `src/ui/utils/http-utils.js`
  - `src/ui/utils/mime-types.js`
  - `src/ui/utils/slug.js`
  - `src/ui/endpoints/job-endpoints.js`
  - `src/ui/endpoints/job-control-endpoints.js`
  - `src/ui/endpoints/pipelines-endpoint.js`
  - `src/ui/endpoints/pipeline-analysis-endpoint.js`
  - `src/ui/endpoints/pipeline-artifacts-endpoint.js`
  - `src/ui/endpoints/pipeline-type-detail-endpoint.js`
  - `src/ui/endpoints/create-pipeline-endpoint.js`
  - `src/ui/endpoints/file-endpoints.js`
  - `src/ui/endpoints/upload-endpoints.js`
  - `src/ui/endpoints/task-creation-endpoint.js`
  - `src/ui/endpoints/task-analysis-endpoint.js`
  - `src/ui/endpoints/task-save-endpoint.js`
  - `src/ui/endpoints/sse-endpoints.js`
  - `src/ui/endpoints/state-endpoint.js`
  - `src/ui/endpoints/schema-file-endpoint.js`

### 9. UI Client

- **MODULE_NAME:** `ui/client`
- **OUTPUT:** `docs/specops/specs/analysis/ui/ui-client.md`
- **SOURCE_FILES:**
  - `src/ui/client/main.jsx`
  - `src/ui/client/bootstrap.js`
  - `src/ui/client/api.js`
  - `src/ui/client/sse-fetch.js`
  - `src/ui/client/time-store.js`
  - `src/ui/client/hooks/useJobList.js`
  - `src/ui/client/hooks/useJobListWithUpdates.js`
  - `src/ui/client/hooks/useJobDetailWithUpdates.js`
  - `src/ui/client/hooks/useAnalysisProgress.js`
  - `src/ui/client/adapters/job-adapter.js`

### 10. UI State

- **MODULE_NAME:** `ui/state`
- **OUTPUT:** `docs/specops/specs/analysis/ui/ui-state.md`
- **SOURCE_FILES:**
  - `src/ui/state.js`
  - `src/ui/state-snapshot.js`
  - `src/ui/watcher.js`
  - `src/ui/job-change-detector.js`
  - `src/ui/lib/analysis-lock.js`
  - `src/ui/lib/mention-parser.js`
  - `src/ui/lib/schema-loader.js`
  - `src/ui/lib/sse.js`
  - `src/ui/lib/task-reviewer.js`
  - `src/ui/transformers/list-transformer.js`
  - `src/ui/transformers/status-transformer.js`

### 11. UI Components

- **MODULE_NAME:** `ui/components`
- **OUTPUT:** `docs/specops/specs/analysis/ui/ui-components.md`
- **SOURCE_FILES:**
  - `src/pages/PromptPipelineDashboard.jsx`
  - `src/pages/PipelineList.jsx`
  - `src/pages/PipelineDetail.jsx`
  - `src/pages/PipelineTypeDetail.jsx`
  - `src/pages/Code.jsx`
  - `src/components/Layout.jsx`
  - `src/components/JobTable.jsx`
  - `src/components/JobCard.jsx`
  - `src/components/JobDetail.jsx`
  - `src/components/DAGGrid.jsx`
  - `src/components/PipelineDAGGrid.jsx`
  - `src/components/StageTimeline.jsx`
  - `src/components/TaskDetailSidebar.jsx`
  - `src/components/TaskCreationSidebar.jsx`
  - `src/components/TaskAnalysisDisplay.jsx`
  - `src/components/AnalysisProgressTray.jsx`
  - `src/components/PipelineTypeTaskSidebar.jsx`
  - `src/components/AddPipelineSidebar.jsx`
  - `src/components/PageSubheader.jsx`
  - `src/components/SchemaPreviewPanel.jsx`
  - `src/components/TaskFilePane.jsx`
  - `src/components/UploadSeed.jsx`
  - `src/components/MarkdownRenderer.jsx`
  - `src/components/LiveText.jsx`
  - `src/components/TimerText.jsx`
  - `src/components/ui/badge.jsx`
  - `src/components/ui/button.jsx`
  - `src/components/ui/card.jsx`
  - `src/components/ui/progress.jsx`
  - `src/components/ui/separator.jsx`
  - `src/components/ui/sidebar.jsx`
  - `src/components/ui/toast.jsx`
  - `src/components/ui/CopyableCode.jsx`
  - `src/components/ui/Logo.jsx`
  - `src/components/ui/RestartJobModal.jsx`
  - `src/components/ui/StopJobModal.jsx`

---

## Other Subsystems

### 12. Providers

- **MODULE_NAME:** `providers`
- **OUTPUT:** `docs/specops/specs/analysis/providers.md`
- **SOURCE_FILES:**
  - `src/providers/base.js`
  - `src/providers/anthropic.js`
  - `src/providers/openai.js`
  - `src/providers/gemini.js`
  - `src/providers/deepseek.js`
  - `src/providers/moonshot.js`
  - `src/providers/zhipu.js`
  - `src/providers/claude-code.js`
  - `src/llm/index.js`

### 13. CLI

- **MODULE_NAME:** `cli`
- **OUTPUT:** `docs/specops/specs/analysis/cli.md`
- **SOURCE_FILES:**
  - `src/cli/index.js`
  - `src/cli/run-orchestrator.js`
  - `src/cli/analyze-task.js`
  - `src/cli/update-pipeline-json.js`
  - `src/cli/self-reexec.js`

### 14. Task Analysis

- **MODULE_NAME:** `task-analysis`
- **OUTPUT:** `docs/specops/specs/analysis/task-analysis.md`
- **SOURCE_FILES:**
  - `src/task-analysis/index.js`
  - `src/task-analysis/parser.js`
  - `src/task-analysis/extractors/llm-calls.js`
  - `src/task-analysis/extractors/stages.js`
  - `src/task-analysis/extractors/artifacts.js`
  - `src/task-analysis/enrichers/schema-deducer.js`
  - `src/task-analysis/enrichers/schema-writer.js`
  - `src/task-analysis/enrichers/analysis-writer.js`
  - `src/task-analysis/enrichers/artifact-resolver.js`
  - `src/task-analysis/utils/ast.js`

### 15. Config

- **MODULE_NAME:** `config`
- **OUTPUT:** `docs/specops/specs/analysis/config.md`
- **SOURCE_FILES:**
  - `src/config/paths.js`
  - `src/config/models.js`
  - `src/config/log-events.js`
  - `src/config/statuses.js`

### 16. Utils

- **MODULE_NAME:** `utils`
- **OUTPUT:** `docs/specops/specs/analysis/utils.md`
- **SOURCE_FILES:**
  - `src/utils/dag.js`
  - `src/utils/duration.js`
  - `src/utils/formatters.js`
  - `src/utils/geometry-equality.js`
  - `src/utils/id-generator.js`
  - `src/utils/jobs.js`
  - `src/utils/pipelines.js`
  - `src/utils/task-files.js`
  - `src/utils/time-utils.js`
  - `src/utils/token-cost-calculator.js`

### 17. API Validators

- **MODULE_NAME:** `api`
- **OUTPUT:** `docs/specops/specs/analysis/api.md`
- **SOURCE_FILES:**
  - `src/api/index.js`
  - `src/api/files.js`
  - `src/api/validators/json.js`
  - `src/api/validators/seed.js`
