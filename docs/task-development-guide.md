# Task Development Guide

## Overview

This guide explains how to implement pipeline task stages (e.g., ingestion, promptTemplating, inference, validation, integration) that work correctly with the modern task-runner context model.

## Context Model

The task-runner provides a context object to each stage handler with this structure:

```js
{
  io: TaskFileIO,           // File I/O singleton (may be null)
  llm: LLMClient,           // Configured LLM client
  meta: {                     // Pipeline and task metadata
    taskName: string,
    workDir: string,
    jobId: string,
    // ...other metadata
  },
  data: {                       // Stage outputs by stage name
    seed: initialPayload,
    ingestion?: output,
    preProcessing?: output,
    promptTemplating?: output,
    inference?: output,
    // ...other stages
  },
  flags: {},                   // Control flags merged from stages
  logs: [],                  // Internal logs
  currentStage: string,         // Name of current stage
  output: any,                 // Output from the previous non-validation stage
  previousStage: string        // Name of previous non-validation stage
}
```

### Key Rules

- **Stage outputs** are always stored under `context.data[stageName]`.
- **Non-validation stages** update `context.output` for the next stage; validation stages do not.
- **Prompt access**: Inference stages must read prompts exclusively from `context.data.promptTemplating`.

## Stage-by-Stage Guidance

### Ingestion

- Reads from `context.data.seed` (primary) with a fallback to top-level `context.seed`.
- Returns `{ output: <derived-data>, flags: {} }`.
- Write any early artifacts via `context.io.writeArtifact` if available.

### PreProcessing

- Receives the previous stage’s output via `context.output`.
- Returns `{ output: <processed-data>, flags: {} }`.

### PromptTemplating

- Receives prior data via `context.output`.
- Returns `{ output: { system: <string>, prompt: <string>, ...priorFields }, flags: {} }`.
- The runner stores this at `context.data.promptTemplating`.

### Inference

- **IMPORTANT**: Read prompts **only** from `context.data.promptTemplating`.
- Throw an explicit error if `promptTemplating` is missing or lacks `system`/`prompt`.
- Example:

```js
export async function inference(context) {
  const pt = context.data?.promptTemplating;
  if (!pt?.system || !pt?.prompt) {
    throw new Error(
      "promptTemplating output missing required fields: system/prompt"
    );
  }
  const { system, prompt } = pt;

  const response = await context.llm.deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return {
    output: {
      ...context.output,
      llmResponse: response.content,
      metadata: {
        model: response.model,
        tokens: response.usage?.total_tokens,
      },
    },
    flags: {},
  };
}
```

### Validation Stages (validateStructure, validateQuality)

- Read from `context.output` (which includes the latest non-validation stage’s data).
- Return `{ output: { validationResult: { passed, ...details } }, flags: { validationFailed, lastValidationError } }`.
- Set `flags.validationFailed` to trigger refinement when needed.

### Integration

- Consume the final validated/processed output from `context.output`.
- Write final artifacts via `context.io.writeArtifact`.
- Return `{ output: { <final-structure> }, flags: {} }`.

## File I/O

When `context.io` is available:

```js
// Write an artifact
await context.io.writeArtifact("filename.json", JSON.stringify(data, null, 2));

// Write a log line
await context.io.writeLog(
  "stage.log",
  `${new Date().toISOString()} Event message\n`
);
```

## Error Handling

- Throw descriptive errors for missing required data.
- Use try/catch and re-throw with context.
- Log failures via console.error.

## Best Practices

- Return objects that satisfy the `{ output, flags }` contract.
- Prefer immutability: spread prior output when extending.
- Do NOT rely on `context.output` for prompts in inference—use `context.data.promptTemplating`.
- Include helpful console logging for debugging.
