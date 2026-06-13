# Step 2: Extract the JSONL Subprocess Runner

## Source
- Reference implementation: `src/providers/opencode.ts:315-386` (`runOpenCodeCli`)
- Existing types: `src/harness/types.ts` (step 1 output)

## Target files
- **Create**: `src/harness/subprocess.ts`
- **Create**: `src/harness/__tests__/subprocess.test.ts`

## Function signature
```ts
export async function runJsonlSubprocess(args: {
  argv: string[];
  env: Record<string, string>;
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  events: unknown[];
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}>
```

## Behavior (extracted from `runOpenCodeCli`, generalized)
1. Spawn process via `Bun.spawn` with `{ stdout: "pipe", stderr: "pipe", env: { ...process.env, ...args.env }, cwd: args.cwd }`
2. Start a `setTimeout` that kills the process after `timeoutMs`
3. If `signal` is provided and already aborted, kill immediately; otherwise listen for `abort` event and kill
4. Read stdout to string via `new Response(proc.stdout).text()`
5. Await `proc.exited`
6. Clear the timeout timer
7. Parse each non-empty trimmed stdout line as JSON; skip lines that fail to parse (no throw)
8. Read stderr to string
9. Determine `timedOut`: the timeout fired (track via a boolean set in the timeout callback)
10. Return `{ events, stdout, stderr, exitCode: proc.exitCode ?? -1, timedOut }` — **never throws** (caller decides)

## Key differences from `runOpenCodeCli`
- No `textParts` extraction (OpenCode-specific)
- No throws on non-zero exit or timeout — returns the result struct
- Accepts `cwd` and `signal`
- Returns raw `stdout`, `stderr`, `exitCode`, `timedOut`

## Test cases (`src/harness/__tests__/subprocess.test.ts`)
Using vitest (project pattern from `src/harness/__tests__/types.test.ts`).

1. **Two JSONL lines → two parsed events**: Run `bun -e 'console.log(JSON.stringify({a:1})); console.log(JSON.stringify({b:2}))'`, assert `events.length === 2` with correct values
2. **Malformed line is skipped**: Run a command that outputs one valid JSON line and one non-JSON line, assert `events.length === 1`
3. **Timeout kills process**: Run `sleep 10` with `timeoutMs: 100`, assert `timedOut === true` and `exitCode` is non-zero (process was killed)
4. **Non-zero exit reported**: Run `bun -e 'console.error("oops"); process.exit(1)'`, assert `exitCode !== 0` and `stderr` contains "oops", and no throw

## Implementation sequence
1. Create `src/harness/subprocess.ts` with the function
2. Create `src/harness/__tests__/subprocess.test.ts` with the four test cases
3. Run `bun test src/harness/__tests__/subprocess.test.ts` to verify
