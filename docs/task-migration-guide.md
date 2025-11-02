# Task Migration Guide

## Overview

This guide helps you migrate existing task implementations to use the modern context model where prompts are read exclusively from `context.data.promptTemplating`.

## Breaking Change

Inference stages must no longer read prompts from `context.output`. They must read exclusively from `context.data.promptTemplating` and throw an error if missing.

## Migration Steps

### 1. Update Inference Stages

Replace this pattern:

```js
// OLD (incorrect)
export async function inference(context) {
  const { system, prompt } = context.output; // ❌ Wrong source

  const response = await context.llm.deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return { output: { ...context.output, result: response.content }, flags: {} };
}
```

With this pattern:

```js
// NEW (correct)
export async function inference(context) {
  const pt = context.data?.promptTemplating;
  if (!pt?.system || !pt?.prompt) {
    throw new Error(
      "promptTemplating output missing required fields: system/prompt"
    );
  }
  const { system, prompt } = pt; // ✅ Correct source

  const response = await context.llm.deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return { output: { ...context.output, result: response.content }, flags: {} };
}
```

### 2. Remove Legacy Fallbacks

If your inference stage has fallbacks like:

```js
// Remove these fallbacks
const { system, prompt } =
  context.output || context.data.promptTemplating || {};
```

Delete them and rely solely on the required `context.data.promptTemplating` check.

### 3. Update Context Access for Other Stages

Ensure ingestion stages read from `context.data.seed` first:

```js
// Preferred
const rawSeed = context?.data?.seed ?? context?.seed;

// Use the data in stage processing
const result = { output: { topic: rawSeed.topic }, flags: {} };
```

### 4. Verify Stage Contracts

Each stage must return:

```js
{
  output: <any>,     // Data for next stage
  flags: {           // Control flags
    validationFailed?: boolean,
    lastValidationError?: string,
    // ...other flags
  }
}
```

Validation stages set `validationFailed`; non-validation stages typically return empty `flags: {}`.

### 5. Test with Missing PromptTemplating

Verify that inference stages fail fast when `promptTemplating` is missing:

```js
// This should throw immediately:
const context = { data: {} }; // No promptTemplating
await inference(context); // Should throw error
```

## Checklist

- [ ] All inference stages read from `context.data.promptTemplating`
- [ ] All inference stages throw when `promptTemplating` or its fields are missing
- [ ] Removed any legacy fallbacks to `context.output` for prompts
- [ ] All stages return `{ output, flags }` contract
- [ ] Ingestion stages prefer `context.data.seed`
- [ ] No unit test changes (as specified)

## Common Errors

| Error                                                            | Cause                                               | Fix                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `promptTemplating output missing required fields: system/prompt` | Inference stage still reading from `context.output` | Update to read from `context.data.promptTemplating`                                             |
| `Cannot read properties of undefined`                            | Missing null checks                                 | Add optional chaining: `context.data?.promptTemplating`                                         |
| Validation stages not triggering refinement                      | Flags not set correctly                             | Ensure validation stages return `flags: { validationFailed: true, lastValidationError: "..." }` |

## After Migration

- Pipelines without promptTemplating will fail fast with clear errors.
- All stages use consistent context access patterns.
- No legacy prompt reading patterns remain.
