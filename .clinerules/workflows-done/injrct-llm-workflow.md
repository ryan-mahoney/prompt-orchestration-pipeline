<task_objective>
Implement a "named models" layer that replaces the existing LLM abstraction so that context.llm exposes only provider-grouped functions (e.g., context.llm.deepseek.reasoner()) with no backwards compatibility to the flatmap approach. This workflow must run start-to-finish with no human interaction, automatically choosing the most pragmatic approach, committing after each step, and carrying forward key decisions between steps.
</task_objective>

<detailed_sequence_of_steps>

## Step 0 — Bootstrap: Create feature branch and record baseline

- Goal: Create the working branch and confirm baseline tests (no code changes).
- Actions:
  - Create branch: feat/llm/named-models-api
  - Run the full test suite to establish baseline.
  - Record that we will replace the current context.llm with provider-grouped functions only (breaking change).
- Acceptance criteria:
  - Branch exists.
  - Baseline tests green (or known consistent baseline).
- Conventional Commit:
  - chore: start branch feat/llm/named-models-api and record baseline

<new_task>
<context>
Carry-over:

- Branch: feat/llm/named-models-api
- Strategy: Breaking replacement for current context.llm, removing flatmap approach.
- No code changes yet; baseline is green.

Next: Add llm.models registry to config (schema + defaults).
</context>
</new_task>

## Step 1 — Config: add llm.models registry (schema + defaults)

- Goal: Provide a central registry mapping human-friendly aliases to { provider, model } pairs.
- Files to update:
  - config.schema.json: add llm.models object with alias → { provider: enum(openai|deepseek|anthropic|mock), model: string }.
  - config.example.json: add a sane default registry, e.g.:
    - "openai:gpt-4" → { provider: "openai", model: "gpt-4" }
    - "openai:gpt-4-turbo" → { provider: "openai", model: "gpt-4-turbo" }
    - "openai:gpt-5" → { provider: "openai", model: "gpt-5-chat-latest" }
    - "deepseek:reasoner" → { provider: "deepseek", model: "deepseek-reasoner" }
    - "deepseek:chat" → { provider: "deepseek", model: "deepseek-chat" }
    - "anthropic:opus" → { provider: "anthropic", model: "claude-3-opus" }
    - "anthropic:sonnet" → { provider: "anthropic", model: "claude-3-sonnet" }
- Tests (augment existing):
  - tests/config.test.js: assert getConfig().llm.models contains sample aliases and preserves structure.
- Acceptance criteria:
  - getConfig().llm.models returns configured aliases.
  - Existing config tests remain green.
- Conventional Commit:
  - feat(config): add llm.models registry support with schema and defaults

<new_task>
<context>
Carry-over:

- Registry shape decided: alias → { provider, model }
- Defaults present in config.example.json
- Schema validates basic structure and provider enum

Next: Implement named model functions and attach to context.llm via createLLM.
</context>
</new_task>

## Step 2 — LLM: expose only provider-grouped functions via createLLM

- Goal: Replace src/llm/index.js to generate only provider-grouped functions from the registry and attach them to the returned llm object.
- Scope (no code shown, only behavior described):
  - Add a pure helper to build functions from the registry:
    - Provider-grouped only: llm.openai.gpt4(opts), llm.openai.gpt4Turbo(opts), llm.deepseek.reasoner(opts), llm.anthropic.opus(opts), etc. (model names camel-cased predictably).
    - NO flatmap approach: do NOT expose llm.models["provider:model"] functions.
  - Each named function augments options.metadata.alias (e.g., "openai:gpt-4") so llm:request:\* events include alias for observability.
  - Replace existing APIs: remove chat, complete, createChain, withRetry, parallel, getAvailableProviders - only provider-grouped functions remain.
  - Respect provider overrides in opts (last-write-wins), but the named function chooses sensible defaults from registry.
  - **Context Integration**: The new provider-grouped functions will be available through the existing `context.llm` object that task functions already receive. No changes to the context injection mechanism are needed - the `createLLM` function will continue to populate `context.llm` as before, just with the new provider-grouped API.
- Tests:
  - New tests/llm.named-models.test.js:
    - exposes only provider-grouped functions (no .models[...] access).
    - routes provider/model correctly (use registerMockProvider).
    - emits events including metadata.alias.
    - verifies flatmap approach is NOT available.
- Acceptance criteria:
  - Only provider-grouped functions exist and call through to chat with correct provider/model.
  - Events include alias when invoked through named functions.
  - Flatmap approach (llm.models["..."]) is explicitly not available.
  - All LLM tests green.
- Conventional Commit:
  - feat(llm)!: replace LLM abstraction with provider-grouped functions only

<new_task>
<context>
Carry-over:

- context.llm will now have ONLY:
  - grouped functions under llm.<provider>.<camelModelName>
- NO flatmap approach: no llm.models["provider:model"] access
- Events include metadata.alias when called via named functions
- Existing chat/complete APIs removed (breaking change)

Next: Verify context wiring through task-runner with an integration-like test.
</context>
</new_task>

## Step 3 — Integration-lite: verify provider-grouped functions via task-runner

- Goal: Ensure tasks can call only the provider-grouped functions through context.llm in a pipeline run.
- Scope:
  - Add a minimal test that:
    - Registers a mock provider.
    - Runs runPipeline on a tiny task module whose stage calls context.llm.mock.gpt35(...)
    - Asserts ok result and that events/usage are consistent.
  - Leverage existing runner behavior; no changes to task-runner expected.
- Acceptance criteria:
  - context.llm includes only provider-grouped functions inside task execution.
  - Pipeline run returns ok; metrics remain collected.
- Conventional Commit:
  - test(task-runner): verify context.llm exposes only provider-grouped functions in pipeline stages

<new_task>
<context>
Carry-over:

- Only provider-grouped functions work in-task
- Flatmap approach confirmed to be unavailable
- Runner wiring unchanged (createLLM picks up registry via getConfig())

Next: Update docs to explain the new layer and usage patterns.
</context>
</new_task>

## Step 4 — Documentation: update LLM README and architecture notes

- Goal: Document the new provider-grouped functions layer and registry.
- Files:
  - src/llm/README.md: add "Provider-Grouped Functions" section with examples (only provider-grouped approach), note metadata.alias in events, and document that flatmap approach is removed.
  - docs/architecture.md: update LLM Layer section to describe the breaking change to provider-grouped functions only and removal of backwards compatibility.
- Acceptance criteria:
  - Clear documentation of the new API with no notes about breaking changes.
- Conventional Commit:
  - docs(llm): document provider-grouped functions

<new_task>
<context>
Carry-over:

- Design documented
- Registry defaults and schema are referenced

Next: Optional, low-risk demo showcase to illustrate usage (can be skipped if stability is preferred).
</context>
</new_task>

## Step 5 — Final verification and green build

- Goal: Ensure everything passes and is ready to merge.
- Actions:
  - Run the full test suite.
  - Fix any lints or small nits.
  - Create and publish a PR according to .clinerules
- Acceptance criteria:
  - All tests pass deterministically; no regressions introduced.
- Conventional Commit:
  - chore(repo): finalize named models layer (tests green)

</detailed_sequence_of_steps>
