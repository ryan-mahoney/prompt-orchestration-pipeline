# SpecOps Implementation Spec Review Orchestration

This document defines the execution plan for reviewing Phase 4 (Implementation Specification) outputs. Each step invokes the review prompt (`docs/specops/review-spec-prompt.md`) with the module variables filled in for a specific subsystem.

Execute each step by providing the review prompt with the **SPEC_PATH** and **SPEC_REVIEW_PATH** listed below. Each step reads an implementation spec from `docs/specops/specs/implementation/` and produces one review in `docs/specops/specs/review/`.

---

## Core Subsystem

### 1. Orchestrator

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/orchestrator.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/orchestrator.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/orchestrator.md`

### 2. Pipeline Runner

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/pipeline-runner.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/pipeline-runner.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/pipeline-runner.md`

### 3. Task Runner

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/task-runner.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/task-runner.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/task-runner.md`

### 4. File I/O

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/file-io.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/file-io.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/file-io.md`

### 5. Batch Runner

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/batch-runner.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/batch-runner.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/batch-runner.md`

### 6. Status Writer

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/status-writer.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/status-writer.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/status-writer.md`

### 7. Core Support Modules

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/core/support.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/core/support.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/core/support.md`

---

## UI Subsystem

### 8. UI Server

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/ui/ui-server.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/ui/ui-server.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/ui/ui-server.md`

### 9. UI Client

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/ui/ui-client.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/ui/ui-client.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/ui/ui-client.md`

### 10. UI State

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/ui/ui-state.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/ui/ui-state.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/ui/ui-state.md`

### 11. UI Components

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/ui/ui-components.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/ui/ui-components.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/ui/ui-components.md`

---

## Other Subsystems

### 12. Providers

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/providers.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/providers.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/providers.md`

### 13. CLI

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/cli.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/cli.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/cli.md`

### 14. Task Analysis

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/task-analysis.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/task-analysis.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/task-analysis.md`

### 15. Config

- **ANALYSIS_PATH:** `docs/specops/specs/analysis/config.md`
- **SPEC_PATH:** `docs/specops/specs/implementation/config.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/config.md`

### 16. Utils

- **ANALYSIS_PATH:** _(no analysis spec exists)_
- **SPEC_PATH:** `docs/specops/specs/implementation/utils.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/utils.md`

### 17. API Validators

- **ANALYSIS_PATH:** _(no analysis spec exists)_
- **SPEC_PATH:** `docs/specops/specs/implementation/api.md`
- **SPEC_REVIEW_PATH:** `docs/specops/specs/review/api.md`
