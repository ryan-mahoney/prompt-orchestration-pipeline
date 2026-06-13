# Conformance Criteria: OpenCode Prompt Runner Provider

- Spec source: `.specs/299-opencode-backend-layer/spec.md`
- Phase: phase 1
- Baseline commit: `82d5db3bee82c99def85a90f939014bc7dba5589`
- Blindness: compiled blind; `src/providers/opencode.ts` did not exist, no implementation diff or commit for this spec was read during criteria compilation, and only spec artifacts plus cited pre-existing precedent/context were used.
- Counts: G=5, D=0, S=7, X=5, T=18

## Criteria

### C-1 (S/X) - POP remains the orchestration owner
Source: §4 Design Decisions - "Keep POP as the orchestration owner."
Check: Read `src/core/task-runner.ts`, `src/core/orchestrator.ts`, `src/core/pipeline-runner.ts`, and `src/llm/index.ts`.
Expect: OpenCode-specific logic is confined to the LLM/provider layer; task stages, artifacts, status files, gates, retries, and SSE ownership remain in POP core modules.
Violation means: OpenCode has moved beyond prompt running and has started replacing POP orchestration in phase 1.

### C-2 (G/X) - adapter does not start OpenCode servers
Source: §4 Design Decisions - "Do not use SDK helpers that start servers."
Check: `rg -n "createOpencode\\(|createOpencodeServer|opencode serve" src/providers/opencode.ts`
Expect: no matches.
Violation means: the adapter can start unmanaged long-running OpenCode server processes instead of attaching to user/supervisor-managed servers.

### C-3 (G) - SDK import uses the typed v2 client surface
Source: §4 Dependency Map - "`src/providers/opencode.ts` depends on `@opencode-ai/sdk/v2`"
Check: `rg -n "@opencode-ai/sdk" src/providers/opencode.ts`
Expect: matches import `@opencode-ai/sdk/v2` only; no root `@opencode-ai/sdk` provider import in `src/providers/opencode.ts`.
Violation means: the adapter is using the unversioned SDK surface instead of the spec's v2 client contract.

### C-4 (S/X) - direct providers remain supported
Source: §6 Notes - "Direct providers remain supported."
Check: Read `src/providers/types.ts`, `src/llm/index.ts`, and `src/config/models.ts`.
Expect: OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, Z.ai/Zhipu, Alibaba, and Claude Code remain present in provider types, gateway dispatch/availability where applicable, and model config where they existed before this spec.
Violation means: OpenCode was implemented as a replacement or migration rather than an additive prompt-runner provider.

### C-5 (G/X) - no OpenCode model catalog duplication
Source: §4 Design Decisions - "Do not duplicate OpenCode's model catalog."
Check: `rg -n "opencode:" src/config/models.ts`
Expect: matches only the `opencode:default` alias constant, the `MODEL_CONFIG_RAW["opencode:default"]` entry, and the `DEFAULT_MODEL_BY_PROVIDER` mapping.
Violation means: the implementation mirrored OpenCode's dynamic model catalog into POP's static registry.

### C-6 (S/X) - safe-by-default permissions are applied in both modes
Source: §4 Design Decisions - "Safe-by-default permissions."
Check: Read `src/providers/opencode.ts`.
Expect: `defaultOpenCodePermission()` returns `{ "*": "deny" }`; SDK session creation uses normalized `opencode.permission ?? defaultOpenCodePermission()`; CLI subprocess env sets `OPENCODE_PERMISSION` from caller permission or the same default; the default path does not use `ask` or `allow`.
Violation means: OpenCode can run with permissive defaults or can prompt interactively unless the caller opts into a stricter policy.

### C-7 (G) - CLI path never bypasses permissions
Source: §7 Step 16 - "set `OPENCODE_PERMISSION` to caller-provided permissions or `defaultOpenCodePermission()`"
Check: `rg -n "dangerously-skip-permissions|--permission" src/providers/opencode.ts`
Expect: no matches.
Violation means: the CLI path bypasses or hand-rolls permission behavior instead of using the explicit environment permission config.

### C-8 (S) - availability check stays non-interactive
Source: §5 AC-14 - "must not run commands that prompt for auth."
Check: Read `isOpenCodeAvailable()` in `src/providers/opencode.ts`.
Expect: it checks `PO_OPENCODE_BASE_URL`, `OPENCODE_BASE_URL`, and `Bun.spawnSync(["opencode", "--version"], { timeout: 5000 })` only; it does not run `opencode auth`, `opencode models`, `opencode run`, `opencode serve`, or any command that can prompt.
Violation means: status/availability calls can block, prompt, or perform provider/auth side effects.

### C-9 (S) - base URL resolution order is deterministic
Source: §7 Step 10 - "Resolve base URL from `opencode.baseUrl`, `PO_OPENCODE_BASE_URL`, then `OPENCODE_BASE_URL`."
Check: Read `src/providers/opencode.ts`.
Expect: SDK base URL resolution uses the order `opencode.baseUrl` first, then `process.env["PO_OPENCODE_BASE_URL"]`, then `process.env["OPENCODE_BASE_URL"]`.
Violation means: caller-provided per-request routing can be ignored or environment precedence can change unexpectedly.

### C-10 (S) - CLI optional arguments stay explicit
Source: §7 Step 16 - "include `--agent`, `--dir`, `--session`, and `--attach` only when explicitly supplied"
Check: Read CLI argument construction in `src/providers/opencode.ts`.
Expect: `--model` is emitted only for non-default parsed models; `--agent`, `--dir`, `--session`, and `--attach` are emitted only from explicit request config; no implicit session continuation, directory, attach URL, or model flag is added.
Violation means: CLI mode can carry hidden session/project state or silently change the execution environment.

### C-11 (G) - SDK dependency is production dependency
Source: §7 Step 3 - "Add `@opencode-ai/sdk` to `package.json` dependencies"
Check: `rg -n '"@opencode-ai/sdk"' package.json`
Expect: exactly one match under the top-level `"dependencies"` object, not under `"devDependencies"`.
Violation means: the runtime SDK import can be missing in installed package usage.

### C-12 (S) - local docs preserve the architecture decision
Source: §5 AC-18 - "Local docs reference that the architectural decision is to keep POP orchestration and add OpenCode only as an optional prompt runner."
Check: Read `docs/current-architecture.md` and `docs/provider-requirements.md`.
Expect: both docs reference `.specs/299-opencode-backend-layer/spec.md` and state that OpenCode is an optional prompt runner under POP's LLM provider layer, not a replacement for POP orchestration.
Violation means: future contributors will not see the local architectural boundary when modifying providers or orchestration.

## T Register

- AC-1: Provider types and availability include `opencode`; owned by tests in `src/providers/__tests__/types.test.ts`.
- AC-2: `chat({ provider: "opencode" })` dispatches to `opencodeChat`; owned by tests in `src/llm/__tests__/index.test.ts`.
- AC-3: `createLLMWithOverride` routes OpenCode provider/model calls; owned by tests in `src/llm/__tests__/index.test.ts`.
- AC-4: `opencode:default` is the only OpenCode alias and has zero static pricing; owned by tests in `src/config/__tests__/models.test.ts`.
- AC-5: Dynamic OpenCode `provider/model` strings are accepted without `MODEL_CONFIG`; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-6: SDK mode sends JSON-schema structured output format; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-7: OpenCode structured output becomes `AdapterResponse.content`; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-8: JSON-mode text responses strip fences and parse JSON; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-9: Invalid JSON throws `ProviderJsonParseError` with provider `opencode`; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-10: Text mode returns cleaned text content; owned by tests in `src/providers/__tests__/opencode.test.ts`.
- AC-11: SDK mode attaches to an existing server and does not start OpenCode servers; behavior owned by tests in `src/providers/__tests__/opencode.test.ts`, with structural tripwires C-2 and C-3.
- AC-12: CLI mode uses bounded `opencode run --format json`, permission env, and timeout kill; owned by tests in `src/providers/__tests__/opencode.test.ts`, with structural tripwire C-7.
- AC-13: Default permission config is `{ "*": "deny" }`; owned by tests in `src/providers/__tests__/opencode.test.ts`, with structural invariant C-6.
- AC-14: Availability is non-interactive and synchronous; owned by tests in `src/providers/__tests__/opencode.test.ts` and `src/llm/__tests__/index.test.ts`, with structural check C-8.
- AC-15: Successful OpenCode calls emit complete telemetry with numeric cost; owned by tests in `src/llm/__tests__/index.test.ts`.
- AC-16: Failed OpenCode calls emit error telemetry; owned by tests in `src/llm/__tests__/index.test.ts`.
- AC-17: Missing usage metadata falls back to token estimation; owned by tests in `src/providers/__tests__/opencode.test.ts` and `src/llm/__tests__/index.test.ts`.
- AC-18: Local docs capture the OpenCode prompt-runner decision; no automated test is required by the spec, so C-12 audits the structural doc requirement.
