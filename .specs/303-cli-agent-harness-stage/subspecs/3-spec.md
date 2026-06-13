# Step 3 Subspec: Refactor OpenCode CLI path onto shared runner

## Target files

- `src/providers/opencode.ts` — refactor `runOpenCodeCli` (lines 315-386)
- `src/providers/__tests__/opencode.test.ts` — extend CLI-mode tests

## Current state

`runOpenCodeCli` (lines 315-386) does all of:
1. Spawns `Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })`
2. Sets a `setTimeout` that sets `timedOut = true` and calls `proc.kill()`
3. Reads `proc.stdout` via `new Response(proc.stdout).text()`
4. Awaits `proc.exited`
5. Parses each non-empty line of stdout as JSON (skip unparseable)
6. For events with `type === "text"`, extracts `event.part.text` into `textParts`
7. If `proc.exitCode !== 0`: reads stderr, throws `TimeoutError` if timed out, otherwise throws with stderr
8. Returns `{ text: textParts.join(""), events }`

`runJsonlSubprocess` (step 2) does #1-4 plus stderr capture and returns `{ events, stdout, stderr, exitCode, timedOut }`.

## Concrete edit sequence

### Edit 1: `src/providers/opencode.ts`

1. Add import at top: `import { runJsonlSubprocess } from "../harness/subprocess.ts";`
2. Replace the body of `runOpenCodeCli` (lines 315-386) with:
   - Call `runJsonlSubprocess({ argv: args, env, timeoutMs })`
   - Extract text from `result.events` using the same logic (filter `type === "text"`, read `part.text`)
   - If `result.timedOut`: throw `TimeoutError` with message `OpenCode CLI timed out after ${timeoutMs}ms with exit code ${result.exitCode}: ${result.stderr || text}`
   - If `result.exitCode !== 0`: throw `Error` with message `OpenCode CLI exited with code ${result.exitCode}: ${result.stderr || text}`
   - Return `{ text, events: result.events }`
3. No changes to callers (`opencodeChat` at line 533+).

### Edit 2: `src/providers/__tests__/opencode.test.ts`

Add two new tests in the "CLI mode fallback" describe block:

1. **"returns correct AdapterResponse shape in CLI mode"** — Mock `Bun.spawn` to emit two text events, call `opencodeChat` with `responseFormat: "text"`, assert `result.content` equals concatenated text, `result.text` equals same, and `result.raw` has shape `{ events: [...] }`.

2. **"throws with stderr detail on non-zero exit"** — Mock `Bun.spawn` to exit with code 2 and stderr "access denied", assert the thrown error message includes "exited with code 2" and "access denied".

## Behavior preservation checklist

| Aspect | Original | After refactor |
|--------|----------|---------------|
| Stderr in error message | Read on demand when exitCode ≠ 0 | Always captured by `runJsonlSubprocess`; used identically |
| Timeout error message | `timed out after Xms with exit code N: stderr\|text` | Same format, uses `result.exitCode` (fallback -1 if null) |
| Non-zero exit message | `exited with code N: stderr\|text` | Same format |
| Error name | `TimeoutError` for timeout | Same |
| Text extraction | Events with `type === "text"`, extract `part.text` | Same logic, same result |
| Env merge | `{ ...process.env, ...env }` | Same in `runJsonlSubprocess` |
| Malformed JSON lines | Skipped silently | Same (`parseJsonl` skips) |
| Return shape | `{ text: string; events: unknown[] }` | Same |

## Stop conditions

- If `runJsonlSubprocess` does not exist yet (step 2 not done), stop.
- If any existing CLI test breaks after the refactor, investigate and fix.
- If the error message format changes (breaking the string match assertions), fix the implementation to preserve the exact format.
