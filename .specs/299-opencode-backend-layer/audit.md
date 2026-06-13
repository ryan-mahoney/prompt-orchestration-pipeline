# Spec Audit: OpenCode Prompt Runner Provider

- Branch: `299-add-opencode-prompt-runner-provider`
- Merge base: `82d5db3bee82c99def85a90f939014bc7dba5589` (`origin/main`)
- Scope: `git diff 82d5db3bee82c99def85a90f939014bc7dba5589...HEAD`
- Criteria file: `.specs/299-opencode-backend-layer/criteria.md`
- Criteria compile baseline: `82d5db3bee82c99def85a90f939014bc7dba5589`
- Date: 2026-06-13
- Verdict counts: PASS=12, VIOLATION=0, UNVERIFIABLE=0
- Ledger counts: PASS=5, VIOLATION=0, UNVERIFIABLE=0

## Verdict Table

| Criterion | Mode | Title | Verdict |
| --- | --- | --- | --- |
| C-1 | S/X | POP remains the orchestration owner | PASS |
| C-2 | G/X | adapter does not start OpenCode servers | PASS |
| C-3 | G | SDK import uses the typed v2 client surface | PASS |
| C-4 | S/X | direct providers remain supported | PASS |
| C-5 | G/X | no OpenCode model catalog duplication | PASS |
| C-6 | S/X | safe-by-default permissions are applied in both modes | PASS |
| C-7 | G | CLI path never bypasses permissions | PASS |
| C-8 | S | availability check stays non-interactive | PASS |
| C-9 | S | base URL resolution order is deterministic | PASS |
| C-10 | S | CLI optional arguments stay explicit | PASS |
| C-11 | G | SDK dependency is production dependency | PASS |
| C-12 | S | local docs preserve the architecture decision | PASS |

## Criterion Evidence

### C-1 (S/X) - PASS

Evidence: `rg -n "opencode|OpenCode" src/core` returned no matches. OpenCode-specific code is in `src/providers/opencode.ts` and gateway wiring in `src/llm/index.ts:15`, `src/llm/index.ts:133`, and `src/llm/index.ts:466`. POP orchestration files are not changed by this branch.

### C-2 (G/X) - PASS

Check: `rg -n "createOpencode\\(|createOpencodeServer|opencode serve" src/providers/opencode.ts`

Evidence: no matches.

### C-3 (G) - PASS

Check: `rg -n "@opencode-ai/sdk" src/providers/opencode.ts`

Evidence:

- `src/providers/opencode.ts:4` imports `createOpencodeClient` from `@opencode-ai/sdk/v2`.
- `src/providers/opencode.ts:5` imports `OpencodeClient` type from `@opencode-ai/sdk/v2`.

No root `@opencode-ai/sdk` provider import is present in `src/providers/opencode.ts`.

### C-4 (S/X) - PASS

Evidence:

- Provider types still include direct providers plus OpenCode in `src/providers/types.ts:64`.
- Gateway dispatch still includes Alibaba, Anthropic, OpenAI, Gemini, DeepSeek, Moonshot, Z.ai/Zhipu, Claude Code, OpenCode, and mock in `src/llm/index.ts:98`.
- Model config still includes OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, Claude Code, Z.ai, Alibaba, and OpenCode in `src/config/models.ts:1`, `src/config/models.ts:44`, and `src/config/models.ts:111`.

OpenCode is additive; no existing provider family is removed.

### C-5 (G/X) - PASS

Check: `rg -n "opencode:" src/config/models.ts`

Evidence:

- `src/config/models.ts:104` defines `OPENCODE_DEFAULT: "opencode:default"`.
- `src/config/models.ts:421` defines the single `MODEL_CONFIG_RAW["opencode:default"]` entry.
- `src/config/models.ts:499` maps default provider `opencode` to `opencode:default`.

No other `opencode:` model aliases are present.

### C-6 (S/X) - PASS

Evidence:

- `src/providers/opencode.ts:94` defines `defaultOpenCodePermission()` as `{ "*": "deny" }`.
- `src/providers/opencode.ts:377` normalizes `opencode.permission ?? defaultOpenCodePermission()` for SDK session creation.
- `src/providers/opencode.ts:397` passes the normalized permission into `client.session.create`.
- `src/providers/opencode.ts:485` normalizes `opencode.permission ?? defaultOpenCodePermission()` for CLI mode.
- `src/providers/opencode.ts:489` sets `OPENCODE_PERMISSION` from that permission value.

The default path uses `deny`; no default `ask` or `allow` path was found.

### C-7 (G) - PASS

Check: `rg -n "dangerously-skip-permissions|--permission" src/providers/opencode.ts`

Evidence: no matches.

### C-8 (S) - PASS

Evidence:

- `src/providers/opencode.ts:501` implements `isOpenCodeAvailable()`.
- `src/providers/opencode.ts:502` returns true for configured `PO_OPENCODE_BASE_URL` or `OPENCODE_BASE_URL`.
- `src/providers/opencode.ts:507` runs only `Bun.spawnSync(["opencode", "--version"], { timeout: 5000 })`.

The availability check does not run `opencode auth`, `opencode models`, `opencode run`, `opencode serve`, or any other prompt-capable command.

### C-9 (S) - PASS

Evidence: `src/providers/opencode.ts:242` resolves the SDK base URL in the required order: `opencode?.baseUrl`, then `process.env.PO_OPENCODE_BASE_URL`, then `process.env.OPENCODE_BASE_URL`.

### C-10 (S) - PASS

Evidence:

- CLI args begin with bounded run mode in `src/providers/opencode.ts:467`.
- `--model` is emitted only when `parsedModel != null` in `src/providers/opencode.ts:469`.
- `--agent` is emitted only when `opencode.agent != null` in `src/providers/opencode.ts:473`.
- `--dir` is emitted only when `opencode.directory != null` in `src/providers/opencode.ts:477`.
- `--session` is emitted only when `opencode.sessionId != null` in `src/providers/opencode.ts:481`.
- No `--attach` flag is emitted implicitly.

No implicit session continuation, directory, attach URL, or model flag is added.

### C-11 (G) - PASS

Check: `rg -n '"@opencode-ai/sdk"' package.json`

Evidence: `package.json:72` contains exactly one `@opencode-ai/sdk` entry under top-level `dependencies`.

### C-12 (S) - PASS

Evidence:

- `docs/current-architecture.md:83` states OpenCode is an optional prompt runner and references `.specs/299-opencode-backend-layer/spec.md`.
- `docs/provider-requirements.md:189` states OpenCode is not a replacement for POP orchestration and references `.specs/299-opencode-backend-layer/spec.md`.
- `docs/provider-requirements.md:194` states POP still owns task stages, artifacts, status files, gates, retries, and SSE.

## Violations

None.

## Unverifiable

None.

## Pre-Existing

None.

## Ledger Results

### Phase 1

| Invariant | Verdict | Evidence |
| --- | --- | --- |
| I-1 - POP owns orchestration | PASS | `rg -n "opencode|OpenCode" src/core` returned no matches; OpenCode logic is in provider/gateway files. |
| I-2 - OpenCode servers are never started implicitly by provider calls | PASS | `rg -n "createOpencode\\(|createOpencodeServer|opencode serve" src/providers/opencode.ts` returned no matches. |
| I-3 - OpenCode model catalog stays dynamic | PASS | `src/config/models.ts:104`, `src/config/models.ts:421`, and `src/config/models.ts:499` are the only `opencode:` hits. |
| I-4 - OpenCode permissions are safe by default | PASS | `src/providers/opencode.ts:94`, `src/providers/opencode.ts:377`, and `src/providers/opencode.ts:485` use caller permission or `{ "*": "deny" }`. |
| I-5 - Direct providers remain additive peers | PASS | Direct providers remain in `src/providers/types.ts:64`, `src/llm/index.ts:98`, and `src/config/models.ts:1`. |
