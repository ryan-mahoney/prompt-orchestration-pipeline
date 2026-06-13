# Invariants: OpenCode Prompt Runner Provider

## I-1 - POP owns orchestration

- Establishing phase: phase 1
- Source quote: "Keep POP as the orchestration owner."
- Invariant: OpenCode may run prompts through the LLM/provider layer, but POP core continues to own task stages, artifacts, status files, gates, retries, and SSE.
- Suggested check: Read `src/core/task-runner.ts`, `src/core/orchestrator.ts`, `src/core/pipeline-runner.ts`, and `src/llm/index.ts`; confirm OpenCode-specific logic is confined to provider/gateway integration.

## I-2 - OpenCode servers are never started implicitly by provider calls

- Establishing phase: phase 1
- Source quote: "Do not use SDK helpers that start servers."
- Invariant: Provider calls may attach to a configured server or run bounded CLI commands, but they must not start unmanaged `opencode serve` / SDK server processes.
- Suggested check: `rg -n "createOpencode\\(|createOpencodeServer|opencode serve" src/providers/opencode.ts` should return no matches.

## I-3 - OpenCode model catalog stays dynamic

- Establishing phase: phase 1
- Source quote: "Do not duplicate OpenCode's model catalog."
- Invariant: POP keeps only the `opencode:default` static alias; concrete OpenCode models remain dynamic `provider/model` request values.
- Suggested check: `rg -n "opencode:" src/config/models.ts` should match only the `opencode:default` alias constant, config entry, and default provider mapping.

## I-4 - OpenCode permissions are safe by default

- Establishing phase: phase 1
- Source quote: "Safe-by-default permissions."
- Invariant: OpenCode SDK and CLI execution use `{ "*": "deny" }` by default unless the caller explicitly supplies `opencode.permission`.
- Suggested check: Read `src/providers/opencode.ts`; confirm SDK session creation and CLI `OPENCODE_PERMISSION` both use caller permission or `defaultOpenCodePermission()`.

## I-5 - Direct providers remain additive peers

- Establishing phase: phase 1
- Source quote: "Direct providers remain supported."
- Invariant: OpenCode is additive; OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, Z.ai/Zhipu, Alibaba, and Claude Code remain supported providers unless a later spec explicitly deprecates them.
- Suggested check: Read `src/providers/types.ts`, `src/llm/index.ts`, and `src/config/models.ts`; confirm existing direct provider names and dispatch/config paths are still present.
