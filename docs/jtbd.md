# Jobs to be Done (JTBD)

This document outlines the core "Jobs to be Done" for the Prompt Orchestration Pipeline. It maps the system's specific architectural features to the user's underlying motivations and desired outcomes, focusing on the persona of an **AI Engineer** or **Systems Integrator** building autonomous workflows.

## Primary Job: Orchestrate Reliable, Multi-Stage AI Workflows
**"When I am running complex, long-duration AI tasks locally, I want to ensure they complete successfully even if individual components fail, so that I don't waste time or money monitoring fragile scripts."**

### Functional Jobs

#### 1. Ensure Execution Resilience
*   **Situation**: Running experimental or unstable task code that might crash the Node.js process.
*   **Motivation**: Prevent a single task failure from bringing down the entire orchestration system or affecting other running jobs.
*   **Solution Mapping**:
    *   **Process Isolation**: Each pipeline runs in a dedicated child process.
    *   **Symlink Bridge**: Ensures deterministic dependency resolution (`node_modules`) for every run, regardless of the environment state.
    *   **Outcome**: "I can run volatile, experimental code with confidence, knowing the orchestrator will survive crashes."

#### 2. Recover from Interruption
*   **Situation**: An API timeout, network error, or logic bug causes a pipeline to fail halfway through a 10-step process.
*   **Motivation**: Resume execution from the point of failure without re-running expensive upstream tasks (and paying for tokens again).
*   **Solution Mapping**:
    *   **Atomic State Persistence**: Status is saved to `tasks-status.json` after every stage.
    *   **Resumability (`resetJobFromTask`)**: Built-in capability to restart a job from a specific task while preserving previous artifacts.
    *   **Outcome**: "I can fix a bug in step 5 and resume exactly where I left off, saving time and API costs."

#### 3. Enforce Output Quality Automomously
*   **Situation**: LLMs produce variable output that sometimes fails strict schema or quality requirements.
*   **Motivation**: Automatically correct errors without human intervention.
*   **Solution Mapping**:
    *   **Standardized 11-Stage Lifecycle**: Every task follows a rigid flow including `validateStructure`, `validateQuality`, `critique`, and `refine`.
    *   **Refinement Loops**: Configurable loops that feed errors back to the model to self-correct.
    *   **Outcome**: "I can trust the system to catch and fix malformed JSON or poor responses before I ever see them."

---

## Secondary Job: Gain Radical Observability
**"When I have multiple agents running in the background, I want to see exactly what they are doing and how much they are costing in real-time, so that I can optimize performance and debug logic errors."**

### Functional Jobs

#### 1. Monitor Real-Time State
*   **Situation**: Waiting for a "black box" script to finish without knowing if it's hung or working.
*   **Motivation**: See the exact stage, progress, and logs of every active job instantly.
*   **Solution Mapping**:
    *   **Server-Sent Events (SSE)**: State changes push updates to the UI immediately.
    *   **Dashboard**: Centralized view of all jobs (Current, Errors, Complete).
    *   **Outcome**: "I know instantly if a job is stuck or progressing without refreshing the page."

#### 2. Track & Control Costs
*   **Situation**: Running expensive models (e.g., GPT-4, Opus) across iterating loops.
*   **Motivation**: Understand the cost impact of pipeline changes and spot runaway loops.
*   **Solution Mapping**:
    *   **Token Breakdown**: Detailed input/output token counts per task.
    *   **Cost Calculation**: Real-time cost estimation based on provider pricing.
    *   **Outcome**: "I can make informed decisions about which model to use for which task based on actual cost data."

#### 3. Debug Execution Logic
*   **Situation**: A pipeline fails or produces weird output.
*   **Motivation**: Trace the exact inputs, outputs, and internal "thought process" of the agent.
*   **Solution Mapping**:
    *   **Artifact Management**: dedicated storage for every input (seed), output, and execution log.
    *   **Stage-Level Logging**: Granular logs for every step of the 11-stage lifecycle.
    *   **Outcome**: "I can surgically inspect the context and response at any specific stage of execution."

---

## Tertiary Job: Integrate & Scale
**"When I am satisfied with a pipeline design, I want to integrate it easily with other systems and scale its usage, so that it becomes a reliable part of my wider infrastructure."**

### Functional Jobs

#### 1. Integrate via Files (The "Drop-Box" Pattern)
*   **Situation**: Connecting the pipeline to a legacy system, a script, or a human workflow.
*   **Motivation**: Trigger jobs without writing complex API integrations or webhooks.
*   **Solution Mapping**:
    *   **Watch Folder Trigger**: Simply drop a JSON file into `pending/` to start a job.
    *   **Atomic State Transitions**: File moves (`pending` -> `current` -> `complete`) signal status changes reliably to external watchers.
    *   **Outcome**: "I can integrate this system with *anything* that can write a JSON file."

#### 2. Avoid Vendor Lock-In
*   **Situation**: A provider changes pricing, or a new, better model is released.
*   **Motivation**: Switch backend models without rewriting task logic.
*   **Solution Mapping**:
    *   **Unified LLM API**: Support for OpenAI, Anthropic, DeepSeek, Gemini, Moonshot, Zhipu, and Claude Code via a single interface.
    *   **Configuration Registry**: Switch providers globally or per-pipeline via config.
    *   **Outcome**: "I can migrate from GPT-4 to DeepSeek-V3 in minutes by changing a config string."

#### 3. Manage Complexity via Registry
*   **Situation**: Managing dozens of different pipeline types (e.g., "Content Gen", "Data Analysis", "Code Review").
*   **Motivation**: Keep definitions organized and modular.
*   **Solution Mapping**:
    *   **Registry-Based Loading**: Decoupled `registry.json` allows dynamic loading of pipeline definitions.
    *   **Task Mapping**: Reuse specific task logic (e.g., "Generic Research") across multiple different pipelines.
    *   **Outcome**: "I can compose new complex workflows from a library of existing, tested task modules."