# Contents

- [SpecOps Approach](#specops-approach)
- [Spec Artifacts by Module](#spec-artifacts-by-module)
- [Outcome](#outcome)
- [SpecOps Lessons Learned](#specops-lessons-learned)

# SpecOps Approach

This document catalogs the prompts used to execute the [SpecOps method](https://github.com/spec-ops-method/spec-ops) for the POP JavaScript-to-TypeScript migration. SpecOps treats **specifications as the source of truth** — extracting institutional knowledge from a legacy codebase into verified specs before building a replacement.

## Approach

There are three layers of files:

1. **Prompts** ([`prompts/`](prompts/)) — Reusable prompt templates with placeholder variables (e.g. `MODULE_NAME`, `SOURCE_FILES`). These define _what_ to do.
2. **Orchestration files** ([`prompt-orchestration/`](prompt-orchestration/)) — Mapping documents that list every module and fill in the variables for each step. These define _where_ to apply each prompt across the codebase (17 subsystems).
3. **Do-prompts** ([`prompt-orchestration/do-*.md`](prompt-orchestration/)) — Short invocation prompts that reference an orchestration file and a step number, letting you execute one step at a time in a chat session.

The pattern repeats for each phase: write a prompt that performs some part of the process, create an orchestration file that maps that prompt to specific files, then write a do-prompt that lets you call each step individually.

Modern models were capable of performing all phases (analysis, spec generation, review). However, for **implementation**, a sub-agent orchestration approach was required to manage context length — each implementation step is delegated to a separate sub-agent so no single context window has to hold the entire spec plus the full codebase.

## Phase 0: Foundation Setup

These prompts bootstrap the project before any SpecOps analysis begins.

| #   | Prompt                                                             | Purpose                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`prompts/initial-plan-prompt.md`](prompts/initial-plan-prompt.md) | Produces the overall migration plan: phases, subsystem breakdown, migration order, verification strategy. Output: [`initial-plan-output.md`](initial-plan-output.md)                                            |
| 2   | [`prompts/make-agents-prompt.md`](prompts/make-agents-prompt.md)   | Researches best practices (TypeScript, Bun.js, SSE, pipeline orchestration) and synthesizes them into an [`AGENTS.md`](../../AGENTS.md) coding conventions file. Output: [`agents-output.md`](agents-output.md) |
| 3   | [`prompts/ts-setup-prompt.md`](prompts/ts-setup-prompt.md)         | Initializes the [`src/`](../../src/) directory with TypeScript and Bun.js configuration                                                                                                                         |

## Phase 1: Discovery & Analysis (SpecOps Phases 1-2)

Extract comprehensive, language-agnostic behavioral specifications from the existing JS codebase.

| #   | Prompt                                                     | Purpose                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | [`prompts/analysis-prompt.md`](prompts/analysis-prompt.md) | Core analysis prompt — given `MODULE_NAME` and `SOURCE_FILES`, produces an 11-section specification covering purpose, public interface, data models, behavioral contracts, state, dependencies, side effects, error handling, integration points, edge cases, and open questions. Output: one spec per module in [`specs/analysis/`](specs/analysis/) |

## Phase 2: Verification (SpecOps Phase 3)

Review and correct the analysis specs before they become the source of truth.

| #   | Prompt                                                                       | Purpose                                                                                                                    |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 5   | [`prompts/review-analysis-prompt.md`](prompts/review-analysis-prompt.md)     | Reviews a single analysis spec against the source code for accuracy, patches discrepancies. Variable: `ANALYSIS_SPEC_FILE` |
| 6   | [`prompts/analysis-conflict-prompt.md`](prompts/analysis-conflict-prompt.md) | Cross-checks all analysis specs for contradictions and resolves conflicts between them                                     |

## Phase 3: Implementation Specification (SpecOps Phase 4)

Translate verified analysis specs into concrete TypeScript + Bun implementation plans.

| #   | Prompt                                             | Purpose                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | [`prompts/spec-prompt.md`](prompts/spec-prompt.md) | Given an `ANALYSIS_FILE`, produces a 7-section implementation spec: qualifications, problem statement, goal, architecture (with TypeScript types), acceptance criteria, notes, and numbered implementation steps. Output: one spec per module in [`specs/implementation/`](specs/implementation/) |

## Phase 4: Spec Review

Expert review of implementation specs before building.

| #   | Prompt                                                           | Purpose                                                                                                                                                             |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | [`prompts/review-spec-prompt.md`](prompts/review-spec-prompt.md) | Evaluates an implementation spec for gaps, viability, and errors. Writes a structured improvement list. Variables: `ANALYSIS_PATH`, `SPEC_PATH`, `SPEC_REVIEW_PATH` |

## Phase 5: Implementation (SpecOps Phases 4-5)

Build the TypeScript replacement from the approved specs.

| #   | Prompt                                                                             | Purpose                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | [`prompts/spec-runner-prompt.md`](prompts/spec-runner-prompt.md)                   | Direct implementation — a senior engineer implements all steps from a spec sequentially, running typecheck and tests after each step, then reports on acceptance criteria. Variable: `SPEC`                                                                                                                               |
| 10  | [`prompts/spec-runner-subagent-prompt.md`](prompts/spec-runner-subagent-prompt.md) | **Sub-agent orchestrator** — delegates each implementation step to a separate sub-agent (via the Task tool) to manage context length. Includes verification between steps, fix-up retries (up to 2 per step), and a final acceptance criteria report. This was the primary implementation approach used. Variable: `SPEC` |

## Orchestration Files

The [`docs/specops/prompt-orchestration/`](prompt-orchestration/) directory contains the mapping and invocation files that drive each phase across all 17 subsystems.

### Orchestration maps

These enumerate every module with its specific file paths and variables, so the same prompt can be applied systematically across the entire codebase:

| File                                                                                              | Phase          | Description                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`analysis-orchestration.md`](prompt-orchestration/analysis-orchestration.md)                     | Discovery      | 17 steps mapping `MODULE_NAME` + `SOURCE_FILES` to the analysis prompt. Covers core (7), UI (4), and other subsystems (6)                                                                                                                         |
| [`spec-orchestration.md`](prompt-orchestration/spec-orchestration.md)                             | Impl Spec      | 17 steps mapping `ANALYSIS_FILE` to `OUTPUT_FILE` for the spec prompt                                                                                                                                                                             |
| [`review-spec-orchestration.md`](prompt-orchestration/review-spec-orchestration.md)               | Spec Review    | 17 steps mapping `ANALYSIS_PATH` + `SPEC_PATH` to `SPEC_REVIEW_PATH` for the review prompt                                                                                                                                                        |
| [`run-implementation-orchestration.md`](prompt-orchestration/run-implementation-orchestration.md) | Implementation | 15 steps in dependency order (config, providers, core support, file-io, status-writer, task-runner, pipeline-runner, orchestrator, batch-runner, task-analysis, cli, UI state/server/client/components) feeding each spec to the sub-agent runner |

### Do-prompts (step invokers)

These are the short prompts you actually paste into a chat session. Each references an orchestration file and a step number to execute one module at a time:

| File                                                                                      | Invokes                                                                                                                            | Usage                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`do-analysis-prompt.md`](prompt-orchestration/do-analysis-prompt.md)                     | [`analysis-orchestration.md`](prompt-orchestration/analysis-orchestration.md) + [`analysis-prompt.md`](prompts/analysis-prompt.md) | "Perform step N" — runs analysis for one module                 |
| [`do-create-spec-prompt.md`](prompt-orchestration/do-create-spec-prompt.md)               | [`spec-orchestration.md`](prompt-orchestration/spec-orchestration.md) + [`spec-prompt.md`](prompts/spec-prompt.md)                 | "Perform step N" — creates implementation spec for one module   |
| [`do-apply-review-prompt.md`](prompt-orchestration/do-apply-review-prompt.md)             | Review output                                                                                                                      | Applies improvements from a review file back to the spec        |
| [`do-run-implementation-prompt.md`](prompt-orchestration/do-run-implementation-prompt.md) | [`spec-runner-subagent-prompt.md`](prompts/spec-runner-subagent-prompt.md)                                                         | Runs the sub-agent implementation orchestrator for a given spec |

## Execution Sequence Summary

```
Foundation Setup
  1. initial-plan-prompt        -> Migration plan
  2. make-agents-prompt         -> AGENTS.md conventions
  3. ts-setup-prompt            -> TypeScript + Bun project scaffold

Discovery (x17 modules)
  4. do-analysis-prompt [1-17]  -> analysis-prompt applied per module
                                   -> docs/specops/specs/analysis/*.md

Verification
  5. review-analysis-prompt     -> Patch inaccuracies per spec
  6. analysis-conflict-prompt   -> Resolve cross-spec contradictions

Implementation Specs (x17 modules)
  7. do-create-spec-prompt [1-17] -> spec-prompt applied per module
                                     -> docs/specops/specs/implementation/*.md

Spec Review (x17 modules)
  8. review-spec-prompt [1-17]    -> Review each implementation spec
     do-apply-review-prompt       -> Apply review improvements

Implementation (x15 modules, dependency order)
  9. do-run-implementation-prompt -> spec-runner-subagent-prompt
                                     per module, using sub-agents
                                     for context length management
```

# Spec Artifacts by Module

Every module produced three spec documents across the SpecOps phases. All paths are relative to [`docs/specops/specs/`](specs/).

### Core

| Module          | Analysis                                                                   | Implementation                                                                         | Review                                                                 |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Orchestrator    | [analysis/core/orchestrator.md](specs/analysis/core/orchestrator.md)       | [implementation/core/orchestrator.md](specs/implementation/core/orchestrator.md)       | [review/core/orchestrator.md](specs/review/core/orchestrator.md)       |
| Pipeline Runner | [analysis/core/pipeline-runner.md](specs/analysis/core/pipeline-runner.md) | [implementation/core/pipeline-runner.md](specs/implementation/core/pipeline-runner.md) | [review/core/pipeline-runner.md](specs/review/core/pipeline-runner.md) |
| Task Runner     | [analysis/core/task-runner.md](specs/analysis/core/task-runner.md)         | [implementation/core/task-runner.md](specs/implementation/core/task-runner.md)         | [review/core/task-runner.md](specs/review/core/task-runner.md)         |
| File I/O        | [analysis/core/file-io.md](specs/analysis/core/file-io.md)                 | [implementation/core/file-io.md](specs/implementation/core/file-io.md)                 | [review/core/file-io.md](specs/review/core/file-io.md)                 |
| Batch Runner    | [analysis/core/batch-runner.md](specs/analysis/core/batch-runner.md)       | [implementation/core/batch-runner.md](specs/implementation/core/batch-runner.md)       | [review/core/batch-runner.md](specs/review/core/batch-runner.md)       |
| Status Writer   | [analysis/core/status-writer.md](specs/analysis/core/status-writer.md)     | [implementation/core/status-writer.md](specs/implementation/core/status-writer.md)     | [review/core/status-writer.md](specs/review/core/status-writer.md)     |
| Core Support    | [analysis/core/support.md](specs/analysis/core/support.md)                 | [implementation/core/support.md](specs/implementation/core/support.md)                 | [review/core/support.md](specs/review/core/support.md)                 |

### UI

| Module        | Analysis                                                           | Implementation                                                                 | Review                                                         |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| UI Server     | [analysis/ui/ui-server.md](specs/analysis/ui/ui-server.md)         | [implementation/ui/ui-server.md](specs/implementation/ui/ui-server.md)         | [review/ui/ui-server.md](specs/review/ui/ui-server.md)         |
| UI Client     | [analysis/ui/ui-client.md](specs/analysis/ui/ui-client.md)         | [implementation/ui/ui-client.md](specs/implementation/ui/ui-client.md)         | [review/ui/ui-client.md](specs/review/ui/ui-client.md)         |
| UI State      | [analysis/ui/ui-state.md](specs/analysis/ui/ui-state.md)           | [implementation/ui/ui-state.md](specs/implementation/ui/ui-state.md)           | [review/ui/ui-state.md](specs/review/ui/ui-state.md)           |
| UI Components | [analysis/ui/ui-components.md](specs/analysis/ui/ui-components.md) | [implementation/ui/ui-components.md](specs/implementation/ui/ui-components.md) | [review/ui/ui-components.md](specs/review/ui/ui-components.md) |

### Other Subsystems

| Module        | Analysis                                                     | Implementation                                                           | Review                                                   |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Providers     | [analysis/providers.md](specs/analysis/providers.md)         | [implementation/providers.md](specs/implementation/providers.md)         | [review/providers.md](specs/review/providers.md)         |
| CLI           | [analysis/cli.md](specs/analysis/cli.md)                     | [implementation/cli.md](specs/implementation/cli.md)                     | [review/cli.md](specs/review/cli.md)                     |
| Task Analysis | [analysis/task-analysis.md](specs/analysis/task-analysis.md) | [implementation/task-analysis.md](specs/implementation/task-analysis.md) | [review/task-analysis.md](specs/review/task-analysis.md) |
| Config        | [analysis/config.md](specs/analysis/config.md)               | [implementation/config.md](specs/implementation/config.md)               | [review/config.md](specs/review/config.md)               |

## Testing

New unit tests were created from scratch following Bun.js and TypeScript best practices rather than porting the legacy test suite. Hundreds of tests were generated as part of the implementation specs, and getting them all to pass was an integral part of the process — each implementation step included targeted test assertions that had to succeed before moving on.

After all automated tests passed, manual testing was used to walk through each core function of the application and verify end-to-end behavior. During this manual verification, 22 issues were identified and cataloged in [manual-fixes.md](manual-fixes.md). All 22 issues were resolved by the AI model — no code was written by hand.

# Outcome

The migration was completed and merged in [PR #251](https://github.com/ryan-mahoney/prompt-orchestration-pipeline/pull/251). The project was deemed complete upon successfully running the demo and verifying each feature.

Although there were lessons learned (see [SpecOps Lessons Learned](#specops-lessons-learned)) that could have reduced the number of manual fixes, the entire migration — analysis, specification, implementation, and testing of a fairly complex application with a frontend, backend, server-sent events, file watchers, and external API integrations — took less than a day. The project now benefits from TypeScript's type safety and Bun's performance over the previous JavaScript and Express stack.

# SpecOps Lessons Learned

## Purpose

This document turns the issue log in [manual-fixes.md](manual-fixes.md) into process guidance for future SpecOps runs. The goal is not to catalog every bug; it is to identify what information or guardrails were missing from the SpecOps workflow that made those bugs likely.

## How To Use `manual-fixes.md`

Treat [manual-fixes.md](manual-fixes.md) as a postmortem input, not as a to-do list. For each issue:

1. Identify the missing context, missing constraint, or missing validation step.
2. Convert that into a reusable rule for prompts, specs, or implementation checklists.
3. Prefer changes that make the next run more deterministic rather than changes that depend on the implementer being more careful.

## Repeating Failure Patterns

The issues in [manual-fixes.md](manual-fixes.md) cluster into a few recurring themes:

- Build and runtime entrypoints were implemented without enough awareness of [`package.json`](../../package.json), Bun scripts, and the actual startup flow.
- The implementation agent did not have enough codebase context to preserve existing structure, routing, filesystem layout, or legacy UI behavior.
- Specs were too large, which made it easier to skip implicit contracts and harder to verify each step.
- Some generated work used placeholders or incomplete wiring instead of finishing the integration path.
- UI behavior was specified at too high a level, so important screen-by-screen intent was lost.
- Environment and project setup expectations were not captured as first-class spec inputs.

## Lessons

### 1. Project setup must be specified explicitly

There should have been a dedicated spec for project setup, local environment, build entrypoints, and run commands before any feature or module implementation work began.

That setup spec should cover:

- runtime and package manager expectations
- required scripts in [`package.json`](../../package.json)
- build entrypoints and output locations
- local development commands
- environment variables and `.env` expectations
- expected directory layout for generated and runtime files

Without this, the implementation work guessed at entrypoints and startup behavior, which is visible in the build and launch failures in the manual fixes log.

### 2. Screen inventory is required for UI work

A per-screen inventory should exist before generating UI implementation specs. Each screen should describe:

- route
- purpose
- primary data shown
- user actions
- live-update behavior
- dependencies on backend state
- relationship to adjacent screens
- legacy screen or component that should be preserved

This would have reduced drift in routing, DAG behavior, file refresh behavior, and layout fidelity.

### 3. Specs need to be smaller and more testable

Several failures suggest that specs bundled too much responsibility into one implementation pass. Large specs encourage partial completion and make it harder to notice missing contracts.

Future specs should be more granular:

- split setup from feature implementation
- split backend contracts from UI rendering
- split filesystem layout from task execution logic
- split migration/parity work from net-new behavior

Each spec should have narrow acceptance criteria that can be verified with a small number of commands or targeted tests.

### 4. Placeholder stubs should be disallowed

There should be an explicit rule against creating stubs, placeholder implementations, fake adapters, or incomplete compatibility layers unless the spec explicitly asks for them.

The rule should be:

- no stub modules
- no placeholder routes
- no fake task/status wiring
- no partial filesystem scaffolding presented as complete
- no “follow-up required” code unless the spec marks the step as intentionally deferred

If something cannot be implemented fully, the run should fail clearly instead of silently introducing an incomplete path.

### 5. The implementation runner needs broader codebase access

The implementation spec runner was too quarantined from the existing codebase. That increased the chance of re-creating structures incorrectly and missing established behavior.

For future runs, the implementation agent should be instructed to inspect:

- [`package.json`](../../package.json) and relevant Bun scripts
- existing [`src/`](../../src/) modules adjacent to the target area
- legacy reference implementations when parity matters
- routing definitions
- current filesystem conventions
- existing tests and fixtures

Quarantine is useful for limiting noise, but it should not prevent the agent from reading the contracts it is supposed to preserve.

## Process Changes To Make

### Add a new prerequisite spec

Create a prerequisite spec for:

- project setup
- local environment
- filesystem layout
- build/run/test entrypoints
- required env vars
- legacy/new code boundaries

This spec should be implemented first.

### Add a UI inventory artifact

Create a `screen-inventory.md` style artifact before UI specs are written. It should be referenced by the planning prompt and the implementation prompt whenever UI routes or components are involved.

### Tighten prompt rules

Update SpecOps prompts and checklists to require:

- reading [`package.json`](../../package.json) before changing runtime or build behavior
- checking neighboring modules before introducing new structure
- consulting legacy code for parity-sensitive UI work
- failing rather than stubbing when required context is missing
- calling out missing setup or environment assumptions as blockers

### Tighten implementation validation

The implementation checklist should explicitly verify:

- build scripts and runtime entrypoints actually exist
- routes resolve correctly
- expected runtime directories and symlinks are created in the correct location
- streaming and live-update UI behavior is observable
- task/status data appears end-to-end in both files and UI

## Proposed Rules For Future SpecOps Runs

- Always create and implement a project setup/environment spec first.
- Always create a per-screen inventory before UI implementation specs.
- Prefer small specs with narrow acceptance criteria over broad multi-system specs.
- Do not allow stubs unless the spec explicitly marks them as temporary and names the follow-up owner.
- Give implementation agents read access to the relevant existing code, scripts, routes, tests, and legacy references.
- Treat post-run manual fixes as evidence of a missing process rule, not just a one-off bug.

## Suggested Follow-Up Documents

- Update [initial-plan-prompt.md](prompts/initial-plan-prompt.md) to require a setup spec and UI inventory when applicable.
- Update [spec-runner-subagent-prompt.md](prompts/spec-runner-subagent-prompt.md) to require reading `package.json`, neighboring modules, and legacy references where relevant.
- Update [do-run-implementation-prompt.md](prompt-orchestration/do-run-implementation-prompt.md) and [run-implementation-orchestration.md](prompt-orchestration/run-implementation-orchestration.md) to ban stubs and add concrete runtime validation steps.

## Bottom Line

The main lesson from [manual-fixes.md](manual-fixes.md) is that the failures were mostly not implementation-only mistakes. They were symptoms of missing setup context, insufficient UI/system inventories, overly broad specs, tolerance for incomplete placeholders, and overly restricted access to the codebase being reimplemented.
