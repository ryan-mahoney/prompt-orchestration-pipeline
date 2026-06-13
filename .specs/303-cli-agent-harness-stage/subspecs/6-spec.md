# Step 6: Implement the executor

## Target files
- Create: `src/harness/executor.ts`
- Create: `src/harness/__tests__/executor.test.ts`

## Source files (read)
- `src/harness/types.ts` — HarnessRunOptions, HarnessRunResult, HarnessDescriptor, HarnessName
- `src/harness/subprocess.ts` — RunJsonlSubprocessArgs, RunJsonlSubprocessResult, runJsonlSubprocess
- `src/harness/descriptors/index.ts` — DESCRIPTORS record

## Constants
- `DEFAULT_TIMEOUT = 300_000` (5 minutes)

## Executor (`runHarnessTask`)

```
1. Resolve descriptor from DESCRIPTORS[options.harness]
2. descriptor.buildArgv(options) → argv
3. descriptor.buildEnv(options) → { env, tmpFiles }
4. If tmpFiles, write each via Bun.file(path).write(content) (actually Bun.write)
5. Call runJsonlSubprocess({ argv, env, cwd: options.cwd, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT, signal: options.signal })
6. If result.timedOut → throw error with stderr (TimeoutError-like)
7. If result.exitCode !== 0 → throw new Error including stderr
8. descriptor.parseEvents(result.events) → HarnessEvent[]
9. For each event: if options.onEvent, call it
10. Extract finalMessage, usage, costUsd, sessionId from descriptor methods
11. Return HarnessRunResult
12. In finally: delete tmpFiles if they were written
```

## `isHarnessAvailable`
- `Bun.spawnSync(descriptor.versionArgv, { timeout: 5000 })`
- Return `exitCode === 0`

## Tests (inject fake `runJsonlSubprocess`)

1. **Successful run** — returns finalMessage/usage/costUsd/sessionId from parsed events
2. **Non-zero exitCode** — throws error containing stderr
3. **timedOut** — rejects with timeout error
4. **onEvent** — called per parsed event
5. **isHarnessAvailable** — true/false from stubbed spawnSync
