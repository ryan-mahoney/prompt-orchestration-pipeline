# Step 4: Implement the three descriptors

## Target files

| File | Action |
|---|---|
| `src/harness/descriptors/claude.ts` | Create |
| `src/harness/descriptors/codex.ts` | Create |
| `src/harness/descriptors/opencode.ts` | Create |
| `src/harness/descriptors/index.ts` | Create |
| `src/harness/__tests__/descriptors.test.ts` | Create |

## Target symbols

Each descriptor implements `HarnessDescriptor` from `src/harness/types.ts`:
- `name: HarnessName`
- `versionArgv: readonly string[]`
- `buildArgv(o: HarnessRunOptions): string[]`
- `buildEnv(o: HarnessRunOptions): { env: Record<string, string>; tmpFiles?: ... }`
- `parseEvents(lines: unknown[]): HarnessEvent[]`
- `extractFinalMessage(events: HarnessEvent[]): string`
- `extractUsage(events: HarnessEvent[]): HarnessUsage | undefined`
- `extractCostUsd(events: HarnessEvent[]): number | undefined`
- `extractSessionId(events: HarnessEvent[]): string | undefined`

`index.ts` exports `DESCRIPTORS: Record<HarnessName, HarnessDescriptor>`.

## Implementation details

### claude.ts
- `buildArgv`: `["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", ...(model ? ["--model", model] : []), ...(mcp ? ["--mcp-config", JSON.stringify({mcpServers: {popio: {type: "http", url: mcp.url, headers: {Authorization: `Bearer ${mcp.token}`}}}}) : [])]`
- `buildEnv`: returns `{ env: {} }` (no special env needed)
- `parseEvents`: generic — map each line to HarnessEvent by `type` field, default "raw"
- Extractors: look for `type: "result"` event, extract from `usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`, `session_id`

### codex.ts
- `buildArgv`: `["codex", "exec", prompt, "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", cwd, ...(model ? ["-m", model] : []), ...(mcp ? ["-c", `mcp_servers.popio.url="${mcp.url}"`, "-c", 'mcp_servers.popio.bearer_token_env_var="POP_MCP_TOKEN"'] : [])]`
- `buildEnv`: when mcp, set `env.POP_MCP_TOKEN = mcp.token`
- Extractors: look for result-type event

### opencode.ts
- `buildArgv`: `["opencode", "run", prompt, "--format", "json", "--dangerously-skip-permissions", "--dir", cwd, ...(model ? ["--model", model] : [])]`
- `buildEnv`: always set `OPENCODE_PERMISSION`; when mcp, write tmp dir with `opencode.json` config, set `OPENCODE_CONFIG_DIR`
- Extractors: look for result event, extract from `info.tokens.input/output/total`

### Generic parseEvents
All three use the same generic implementation: categorize by `event.type` field from the raw JSON, default to "raw".

## Ordered edit sequence

1. Create `src/harness/descriptors/claude.ts`
2. Create `src/harness/descriptors/codex.ts`
3. Create `src/harness/descriptors/opencode.ts`
4. Create `src/harness/descriptors/index.ts`
5. Create `src/harness/__tests__/descriptors.test.ts`

## Test cases

For each harness:
- `buildArgv` contains the unrestricted flag
- `buildArgv` includes model flag when model given, omits when absent
- `buildArgv` includes cwd flag where applicable (codex `-C`, opencode `--dir`)
- codex: `buildArgv` includes `--skip-git-repo-check` and MCP `-c` overrides; `buildEnv` sets `POP_MCP_TOKEN`
- opencode: `buildArgv` includes `--dangerously-skip-permissions`; `buildEnv` sets `OPENCODE_PERMISSION`; writes `opencode.json`; sets `OPENCODE_CONFIG_DIR`
- claude: `buildArgv` includes `--mcp-config` JSON with `type:"http"`, url, bearer header
- extractors return usage/cost/session from fixture event arrays and `undefined` when absent
- `versionArgv` matches expected value for each harness

## Stop conditions

- Each descriptor file compiles (imports resolve, types match)
- All test cases pass
- No changes to existing files
