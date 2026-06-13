# Step 3: Restructure the SDK path of `opencodeChat`

## Target files/symbols

- `src/providers/opencode.ts` — `opencodeChat` function (lines 388-560)
- `src/providers/__tests__/opencode.test.ts` — SDK session lifecycle + retry + cleanup tests
- `src/llm/__tests__/index.test.ts` — OpenCode provider integration tests

## Current state

- `opencodeChat` creates the client inside the retry loop (line 419)
- Signal is placed in `promptParams` via `as unknown` cast (lines 492-496)
- No session cleanup — sessions leak
- No `createdSessionId` tracking
- Missing-base-URL throw is inside the retry loop (line 413)

## Ordered concrete edit sequence

### 1. Restructure SDK path in `opencodeChat`

Replace the `mode === "sdk"` block (lines 412-516) with:

```ts
if (mode === "sdk") {
  if (baseUrl == null) {
    throw new Error(
      "OpenCode SDK mode requires a base URL: set opencode.baseUrl, PO_OPENCODE_BASE_URL, or OPENCODE_BASE_URL",
    );
  }

  const client = createOpencodeClient({ baseUrl });
  const callerSessionId = opencode.sessionId;
  let sdkSessionID = callerSessionId;
  let createdSessionId: string | undefined;

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!sdkSessionID) {
          const permission = normalizeOpenCodePermission(
            opencode.permission ?? defaultOpenCodePermission(),
          );

          const createParams: Record<string, unknown> = {
            directory: opencode.directory,
            permission,
          };

          if (parsedModel != null) {
            createParams.model = {
              id: parsedModel.modelID,
              providerID: parsedModel.providerID,
            };
          }

          if (opencode.agent != null) {
            createParams.agent = opencode.agent;
          }

          const createResult = await client.session.create(
            createParams as Parameters<typeof client.session.create>[0],
          );

          if (createResult.error) {
            throw new Error(
              `OpenCode session creation failed: ${JSON.stringify(createResult.error)}`,
            );
          }

          sdkSessionID = createResult.data.id;
          createdSessionId = sdkSessionID;
        }

        const promptParams: Parameters<typeof client.session.prompt>[0] = {
          sessionID: sdkSessionID,
          parts: [{ type: "text", text: promptText }],
          directory: opencode.directory,
        };

        if (parsedModel != null) {
          promptParams.model = {
            providerID: parsedModel.providerID,
            modelID: parsedModel.modelID,
          };
        }

        if (opencode.agent != null) {
          promptParams.agent = opencode.agent;
        }

        if (schema != null) {
          const format: Record<string, unknown> = {
            type: "json_schema",
            schema,
          };
          if (opencode.structuredOutputRetryCount != null) {
            format.retryCount = opencode.structuredOutputRetryCount;
          }
          promptParams.format = format as Parameters<typeof client.session.prompt>[0]["format"];
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
          const result = await client.session.prompt(promptParams, {
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (result.error) {
            throw new Error(
              `OpenCode prompt failed: ${JSON.stringify(result.error)}`,
            );
          }

          const raw = result.data;
          const content = extractOpenCodeContent(raw, responseFormat, modelString);
          const text = extractOpenCodeText(raw);
          const usage = normalizeOpenCodeUsage(raw);

          return { content, text, usage, raw };
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt >= maxRetries) {
          throw err;
        }
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw lastError;
  } finally {
    if (createdSessionId != null) {
      await deleteOpenCodeSession(client, createdSessionId);
    }
  }
}
```

Key changes:
- `baseUrl == null` check moved before retry loop
- Client created once above the loop
- `callerSessionId` / `createdSessionId` tracking added
- `promptParams` typed against SDK (`Parameters<typeof client.session.prompt>[0]`)
- Signal moved from `promptParams` to second argument: `client.session.prompt(promptParams, { signal })`
- `as unknown` casts removed
- Retry loop wrapped in `try/finally` with session cleanup
- Removed the outer `let sdkSessionID` and `let lastError` declarations that are now inside the if-block scope; `lastError` stays at the function level since it's used after the loop

Wait — `lastError` is declared at function scope (line 407) and used after the loop (line 559). It must remain at function scope. `sdkSessionID` is currently at function scope too (line 408). In the new design, `sdkSessionID` is scoped inside the `if (mode === "sdk")` block.

Actually, looking at the code more carefully, the CLI path also has a retry loop (the catch at line 550). The outer `for` loop and `lastError` are shared. The `mode === "sdk"` block should just `return` or `throw` from within itself, and the CLI path continues below it. Let me look at the actual control flow again.

Current structure:
```
for attempt 0..maxRetries:
  try:
    if mode === "sdk":
      ... (all SDK logic, eventually returns)
    CLI path (executed if not sdk)
  catch:
    lastError = err
    if not retryable or last attempt: throw
    sleep
throw lastError
```

The SDK path returns from inside the try. The CLI path also runs inside the try and returns from there. The catch handles both. So the restructure needs to keep the SDK logic inside the outer try/catch, but move the client creation and session tracking outside the retry loop.

Actually, re-reading the spec's control flow more carefully:

```
if mode === "sdk":
  if baseUrl == null -> throw
  client = createOpencodeClient({ baseUrl })
  ...
  try:
    for attempt in 0..maxRetries:
      try:
        ...
      catch:
        ...
    throw lastError
  finally:
    if createdSessionId != null:
      await deleteOpenCodeSession(...)
```

The spec wants the retry loop to be INSIDE a try/finally that's specific to the SDK path. This means the SDK path gets its own retry loop, separate from the outer one. The outer `for` loop and `catch` at lines 410/550 become CLI-only.

So the restructure is: the SDK path gets its own complete retry loop + try/finally, and the CLI path keeps the existing outer loop. The SDK path `return`s or `throw`s before falling through to the CLI path.

Let me plan this properly:

```ts
if (mode === "sdk") {
  // throw-before-loop, create client, track session
  // own retry loop in try/finally
  // returns or throws — never falls through to CLI
}

// CLI path (unchanged, keeps existing retry loop)
```

This is cleaner. The `lastError` and outer `for` loop only serve the CLI path now. Actually wait, the current outer for loop wraps BOTH sdk and cli. If I give SDK its own loop, the outer loop becomes CLI-only. But `lastError` is declared at function level and used after the outer loop. Let me think...

Actually, looking at the existing code structure:
```ts
let lastError: unknown;
let sdkSessionID = opencode.sessionId;

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    if (mode === "sdk") {
      // SDK code...
      // returns on success
    }
    // CLI code...
    // returns on success
  } catch (err) {
    lastError = err;
    if (!isRetryableError(err) || attempt >= maxRetries) throw err;
    await sleep(...);
  }
}
throw lastError;
```

The simplest approach: give the SDK path its own retry loop inside a try/finally. Keep the outer loop for CLI only. Remove the now-unused `sdkSessionID` from function scope.

```ts
if (mode === "sdk") {
  if (baseUrl == null) throw new Error(...);
  const client = createOpencodeClient({ baseUrl });
  const callerSessionId = opencode.sessionId;
  let sdkSessionID = callerSessionId;
  let createdSessionId: string | undefined;
  let lastError: unknown;

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // ... create session if needed, prompt, return
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt >= maxRetries) throw err;
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
    throw lastError;
  } finally {
    if (createdSessionId != null) {
      await deleteOpenCodeSession(client, createdSessionId);
    }
  }
}

// CLI path — uses its own lastError loop
let lastError: unknown;
for (let attempt = ...) {
  ...
}
throw lastError;
```

Wait, but that duplicates `lastError`. Hmm. Actually `lastError` is only needed for the "throw after loop" pattern. Let me just make the SDK path self-contained and the CLI path self-contained.

Actually the simplest thing: since the SDK path always either returns or throws (never falls through), I can put the whole SDK block before the CLI block. The SDK block has its own retry loop. The CLI block has its own retry loop. No shared state needed.

Let me write this as the edit plan.</think>### 2. Add new test cases in `opencode.test.ts`

Add to the existing `describe("SDK session lifecycle")` section:

**a) Signal placement tests:**
- `prompt receives signal in options argument, not in parameters` — verify `mockPrompt` was called with `(promptParams, { signal })` where `promptParams` has no `signal` property
- `a never-settling prompt rejects after requestTimeoutMs` — mock prompt to never resolve, set `requestTimeoutMs: 50`, expect rejection

**b) Session cleanup tests:**
- `deletes created session after successful prompt` — expect `mockDelete` called once with `{ sessionID: MOCK_SESSION_ID }`
- `deletes created session after non-retryable prompt error` — mock prompt to throw, expect `mockDelete` called once
- `does not delete caller-supplied sessionId` — pass `sessionId: "existing-id"`, expect `mockDelete` not called
- `one retryable failure then success yields exactly one create and one delete` — mock prompt to fail once then succeed, verify counts

### 3. Add `llm:request:complete` measured usage test in `index.test.ts`

Add test in `"OpenCode provider integration"`:
- Mock SDK (not CLI) path with real-shaped usage data, verify `llm:request:complete` carries measured token counts

## Stop conditions

- If `client.session.prompt` signature doesn't accept `(params, options)`, STOP
- If tests fail after implementation, STOP and report
