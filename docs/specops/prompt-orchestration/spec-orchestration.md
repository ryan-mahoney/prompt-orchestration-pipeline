# SpecOps Implementation Specification Orchestration

This document defines the execution plan for Phase 4 (Implementation Specification) of the JS → TS migration. Each step invokes the spec prompt (`docs/specops/spec-prompt.md`) with the module variables filled in for a specific subsystem.

Execute each step by providing the spec prompt with the **ANALYSIS_FILE** and **OUTPUT_FILE** listed below. Each step reads a verified analysis document from `docs/specops/specs/analysis/` and produces one implementation spec in `docs/specops/specs/implementation/`.

---

## Core Subsystem

### 1. Orchestrator

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/orchestrator.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/orchestrator.md`

### 2. Pipeline Runner

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/pipeline-runner.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/pipeline-runner.md`

### 3. Task Runner

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/task-runner.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/task-runner.md`

### 4. File I/O

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/file-io.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/file-io.md`

### 5. Batch Runner

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/batch-runner.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/batch-runner.md`

### 6. Status Writer

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/status-writer.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/status-writer.md`

### 7. Core Support Modules

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/core/support.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/core/support.md`

---

## UI Subsystem

### 8. UI Server

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/ui/ui-server.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/ui/ui-server.md`

### 9. UI Client

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/ui/ui-client.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/ui/ui-client.md`

### 10. UI State

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/ui/ui-state.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/ui/ui-state.md`

### 11. UI Components

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/ui/ui-components.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/ui/ui-components.md`

---

## Other Subsystems

### 12. Providers

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/providers.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/providers.md`

### 13. CLI

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/cli.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/cli.md`

### 14. Task Analysis

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/task-analysis.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/task-analysis.md`

### 15. Config

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/config.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/config.md`

### 16. Utils

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/utils.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/utils.md`

### 17. API Validators

- **ANALYSIS_FILE:** `docs/specops/specs/analysis/api.md`
- **OUTPUT_FILE:** `docs/specops/specs/implementation/api.md`
