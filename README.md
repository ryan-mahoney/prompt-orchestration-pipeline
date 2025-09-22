# Prompt-Orchestration Pipeline

A **Prompt-orchestration pipeline (POP)** is a framework for building, running, and experimenting with complex chains of LLM tasks.  
Instead of relying on a single mega-prompt, a pipeline decomposes work into stages, applies targeted transformations, validates outputs, and composes multiple model calls into a repeatable workflow.

This repository provides a reference implementation of a Prompt-orchestration pipeline, designed for researchers, engineers, and builders who want to explore **creative, multi-stage strategies that push far beyond what a single prompt can achieve.**

---

## Why It Matters

Single-prompt strategies are fragile:
- Inputs must fit within a single context window.
- Instructions and examples compete for limited space.
- Quality control is all-or-nothing.

A prompt-orchestration pipeline changes the game:
- **Chained reasoning**: break down complex problems into sequential tasks.
- **Context compression & stacking**: condense outputs into artifacts that feed the next stage.
- **Multi-model strategies**: route subtasks to the most appropriate model (fast vs. large, cheap vs. accurate).
- **Validation loops**: enforce structure, apply quality checks, and retry when needed.
- **Experimentation**: swap tasks in and out to try new ideas without rewriting the whole system.

The result: workflows that are **more robust, interpretable, and capable** than any single prompt.

---

## Architecture

A prompt-orchestration pipeline has **two layers**:

### 1. Pipeline Orchestration (the outer layer)

The outer pipeline manages runs, state, and isolation.  
It is responsible for:
- Assigning a pipeline ID for each new run.
- Creating predictable directories for seeds, tasks, artifacts, and status.
- Spawning isolated processes for each task (so one failure doesn’t crash others).
- Tracking progress in `tasks-status.json`.
- Promoting completed runs into `/pipeline-complete` with audit metadata.

Directory structure:

```

/pipeline.json                  # defines the ordered list of tasks
/pipeline-pending/\*.json        # queued seed inputs
/pipeline-current/<id>/          # active run state
/pipeline-complete/<id>/         # archived completed run
/pipeline-tasks/index.js         # registry of available tasks

````

#### High-level diagram

```mermaid
flowchart TD
  A["/pipeline-pending/*-seed.json"] --> B[Orchestrator]
  B --> C["create /pipeline-current/&lt;id&gt;/seed.json"]
  B --> D["create /pipeline-current/&lt;id&gt;/tasks-status.json"]
  B --> E[Read pipeline.json]
  E --> F[Spawn task runner]
  F --> G["write tasks/&lt;task&gt;/letter.json"]
  G --> H[Run task inner pipeline]
  H --> I["write tasks/&lt;task&gt;/output.json"]
  I --> J[Update tasks-status.json]
  J --> K{More tasks}
  K -->|yes| F
  K -->|no| L[Promote to complete]
  L --> M["/pipeline-complete/&lt;id&gt;/**"]
  L --> N["append /pipeline-complete/runs.jsonl"]
````

---

### 2. Task Orchestration (the inner layer)

Each pipeline step runs through a **task runner** that executes canonical sub-tasks:

1. **Ingestion** – retrieve existing data or context.
2. **Pre-processing** – compress or transform input to fit model constraints.
3. **Prompt templating** – assemble the instruction.
4. **Inference** – run the model call(s).
5. **Parsing** – normalize outputs into structured form.
6. **Validation** – check schema, quality, and semantic correctness.
7. **Critique & refinement** – generate hints, re-prompt, and retry if needed.
8. **Finalization** – confirm valid output and persist artifacts.

This inner orchestration ensures each task is **deterministic, inspectable, and re-runnable**.

#### Inner pipeline diagram

```mermaid
flowchart TD
  S[Start task] --> I1[Ingestion retrieve data]
  I1 --> P1[Pre-processing compress transform]
  P1 --> T1[Prompt templating]
  T1 --> INF[Inference one to many model calls]
  INF --> PAR[Parsing normalize structure]
  PAR --> VS[Validate structure]
  VS -->|ok| VQ[Validate quality]
  VS -->|fail| ERR[Fail task and log]
  VQ -->|ok| FIN[Finalize and persist artifacts]
  VQ -->|needs work| CRIT[Critique and hints]
  CRIT --> REF[Refine and re-prompt]
  REF --> PAR
  FIN --> DONE[Done]
  ERR --> DONE
```

---

## Example Flow

1. A seed file is placed into `/pipeline-pending`.
2. The orchestrator creates `/pipeline-current/<id>` with `seed.json` and initializes task directories.
3. Each task runs in sequence:

   * Writes a `letter.json` trigger into its folder.
   * Runs the inner task pipeline.
   * Saves outputs, logs, and updates `tasks-status.json`.
4. On success, the run is moved to `/pipeline-complete/<id>` and appended to `runs.jsonl`.
5. On failure, the run remains in `/pipeline-current` with full artifacts for debugging.

---

## Use Cases

* Multi-model research: prototype workflows that combine GPT-4, Claude, LLaMA, and smaller local models.
* Complex transformations: stack summarization, clustering, re-generation, and scoring to produce publish-quality results.
* Structured data generation: build validated JSON/CSV/Graph outputs reliably with retries and guardrails.
* Experimentation: quickly remix pipelines by editing `pipeline.json` or swapping task modules.

---

## Why This Repository

This repo is meant as a **reference system** for anyone experimenting with advanced prompt engineering.
It is intentionally lightweight: just enough orchestration to run complex pipelines, inspect intermediate artifacts, and evolve new strategies.

By naming and defining the **Prompt-orchestration pipeline**, this project aims to give builders a shared vocabulary and a practical foundation to move past the limitations of single-prompt solutions.

---

## Getting Started

1. Clone the repo.
2. Define your pipeline steps in `pipeline.json`.
3. Add task implementations in `/pipeline-tasks/`.
4. Drop a seed input into `/pipeline-pending/`.
5. Start the orchestrator (`node orchestrator/manager.js`) and watch your pipeline run.

---

## Status

This is an **experimental framework**.
The goal is to explore and evolve best practices for orchestrating prompts, models, and validations into reliable workflows.

Feedback, issues, and contributions are welcome.
