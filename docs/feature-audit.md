# Feature Audit

Based on an analysis of the application's pages (`src/pages`), the following key features and thematic groups have been identified:

## 1. Dashboard & Monitoring
*   **Job Dashboard**: A central dashboard (`PromptPipelineDashboard.jsx`) that provides an overview of all system jobs, categorized by status (Current, Errors, Complete).
*   **Aggregate Progress**: Visualization of aggregate progress for all currently running jobs.
*   **Detailed Job Inspection**: A detailed view (`PipelineDetail.jsx`) for individual job executions, displaying:
    *   Status, progress, and duration.
    *   Cost calculation (total cost, token usage).
    *   Task-level details and execution logs.
    *   Input/output token breakdown.

## 2. Pipeline Management
*   **Pipeline Catalog**: A browsable list of all available pipeline types (`PipelineList.jsx`).
*   **Pipeline Definition View**: A detailed view for specific pipeline types (`PipelineTypeDetail.jsx`) that shows:
    *   Pipeline description and metadata.
    *   Visual representation of the pipeline tasks (DAG).
*   **Configuration Registry**:
    *   **Registry-Based Loading**: Pipelines are dynamically loaded from a `registry.json` file, allowing for easy addition of new workflows without code changes.
    *   **Task Mapping**: Flexible mapping between logical task names and their implementation files (`tasks/index.js`), enabling reuse of task logic.
*   **Pipeline Editing**:
    *   Ability to add new pipeline types.
    *   Ability to add tasks to existing pipelines.
    *   Pipeline analysis tools to validate structure.

## 3. Job Control
*   **Job Execution Management**:
    *   **Stop Job**: Functionality to safely stop running jobs (`StopJobModal` in `PipelineDetail.jsx`).
    *   **Rescan Job**: Ability to trigger a rescan of a job's status/tasks to sync with the backend.

## 4. Developer Experience & Documentation
*   **API Reference**: A dedicated documentation page (`Code.jsx`) that provides comprehensive guides for developers building tasks, including:
    *   **Environment Setup**: Configuration of API keys.
    *   **Getting Started**: Guide on seed files and job initiation.
    *   **Pipeline Configuration**: Schema and options for `pipeline.json` including LLM overrides.
    *   **IO API**: Documentation for file operations (`readArtifact`, `writeLog`, etc.).
    *   **LLM API**: Interface for calling calling language models, including available models and arguments.
    *   **Validation API**: Tools for JSON schema validation.

## 5. Core Platform Features
*   **File-Based Orchestration**:
    *   **Watch Folder Trigger**: Jobs are initiated by simply dropping a seed file into a watched directory (`pending/`), enabling easy integration with external systems.
    *   **Atomic State Transitions**: Job lifecycle is managed through atomic file moves (`pending` → `current` → `complete`), ensuring data integrity.
*   **Resiliency & Isolation**:
    *   **Process Isolation**: Each pipeline runs in its own dedicated child process, preventing crashes in one job from affecting the orchestrator or other jobs.
    *   **Deterministic Module Resolution**: A "Symlink Bridge" mechanism (`symlink-bridge.js`) ensures consistent dependency resolution for tasks, isolating them from environment variations.
*   **Execution Control**:
    *   **Standardized Task Lifecycle**: A rigid 11-stage lifecycle (Ingestion → ... → Integration) enforces consistency and enables advanced features like "Refine Loops" and "Critique".
    *   **Resumability**: Built-in support for restarting jobs from specific tasks (`resetJobFromTask`), preserving previously completed work.
    *   **Lifecycle Policies**: Pre-execution checks that allow for controlled pauses or stops based on job state.
*   **Data & State Management**:
    *   **Atomic Status Updates**: State changes are written atomically to `tasks-status.json`, preventing race conditions.
    *   **Real-Time Observability**: State changes trigger Server-Sent Events (SSE), powering live UI updates without polling.
    *   **Artifact Management**: dedicated handling for job inputs (seeds), outputs (artifacts), and execution logs.

## 6. Supported Integrations
*   **OpenAI**: Full support for GPT-4 and other models.
*   **Anthropic**: Support for Claude 3 Opus, Sonnet, and Haiku.
*   **DeepSeek**: Integration with DeepSeek-V3 and DeepSeek-R1 models.
*   **Google Gemini**: Support for Gemini Pro and Flash models.
*   **Moonshot**: Support for Kimi models.
*   **Zhipu**: Support for GLM-4 models.
*   **Claude Code**: Experimental integration with the Claude Code CLI tool.
