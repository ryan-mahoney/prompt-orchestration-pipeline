# POP Pipeline Task Guide

> Unified reference for creating valid pipeline tasks. Only exported stage functions with exact names below are called by the pipeline runner.

---

## Critical Rules

### Valid Stage Names (Exhaustive List)

The pipeline runner **ONLY** calls these 11 exported functions:

| Stage | Required | Purpose |
|-------|----------|---------|
| `ingestion` | Yes | Load input from `data.seed` |
| `preProcessing` | No | Normalize/enrich data |
| `promptTemplating` | Yes | Build LLM prompts |
| `inference` | Yes | Call LLM |
| `parsing` | No | Parse LLM output |
| `validateStructure` | No | JSON schema validation |
| `validateQuality` | No | Domain-specific checks |
| `critique` | No | Analyze failures |
| `refine` | No | Produce improved output |
| `finalValidation` | No | Final validation gate |
| `integration` | No | Persist results |

### Required Contract

Every stage function must:
1. Be exported: `export const stageName = ...`
2. Return: `{ output: any, flags: object }`

### Anti-Patterns (Invalid)

```js
// ❌ WRONG: Helper functions are NEVER called by pipeline
function formatPrompt(topic) { return `...${topic}...`; }

// ❌ WRONG: Non-standard export names are NEVER called
export const myCustomStage = () => ({ output: {}, flags: {} });

// ❌ WRONG: Must return { output, flags } object
export const ingestion = () => "just a string";
```

---

## Minimal Working Example

A simple 3-stage task (most tasks only need ingestion → promptTemplating → inference):

```js
export const ingestion = ({
  data: { seed: { data: { topic } } },
  flags,
}) => ({
  output: { topic },
  flags,
});

export const promptTemplating = ({
  data: { ingestion: { topic } },
  flags,
}) => ({
  output: {
    system: "You are a helpful assistant. Respond in JSON.",
    prompt: `Write about: ${topic}\n\nRespond as: { "content": "..." }`,
  },
  flags,
});

export const inference = async ({
  io,
  llm: { deepseek },
  data: { promptTemplating: { system, prompt } },
  flags,
}) => {
  const response = await deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  
  const parsed = typeof response.content === "string"
    ? JSON.parse(response.content)
    : response.content;
  
  await io.writeArtifact("output.json", JSON.stringify(parsed, null, 2));
  return { output: {}, flags };
};
```

---

## Stage Function Signatures

### ingestion
```js
export const ingestion = ({ data: { seed }, flags }) => ({
  output: { /* extracted fields */ },
  flags,
});
```

### promptTemplating
```js
export const promptTemplating = ({ data: { ingestion }, flags }) => ({
  output: { system: "...", prompt: "..." },
  flags,
});
```

### inference
**Rule**: Read prompts from `data.promptTemplating`, not from other sources.
```js
export const inference = async ({
  io,
  llm: { provider },
  data: { promptTemplating: { system, prompt } },
  flags,
}) => {
  const response = await provider.model({ messages: [...] });
  await io.writeArtifact("output.json", JSON.stringify(parsed, null, 2));
  return { output: {}, flags };
};
```

### validateStructure
```js
export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const content = await io.readArtifact("output.json");
  const result = validateWithSchema(mySchema, content);
  if (!result.valid) {
    return { output: {}, flags: { ...flags, validationFailed: true } };
  }
  return { output: {}, flags };
};
```

---

## IO API

Available on `io` object passed to stages.

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `io.writeArtifact` | `name, content, { mode? }` | `Promise<string>` | Persist output files |
| `io.writeLog` | `name, content, { mode? }` | `Promise<string>` | Debug/progress logs |
| `io.writeTmp` | `name, content, { mode? }` | `Promise<string>` | Scratch data |
| `io.readArtifact` | `name` | `Promise<string>` | Load artifact |
| `io.readLog` | `name` | `Promise<string>` | Read log |
| `io.readTmp` | `name` | `Promise<string>` | Read temp file |
| `io.getTaskDir` | — | `string` | Current task directory |
| `io.getDB` | `options?` | `Database` | SQLite for job (WAL mode) |
| `io.runBatch` | `{ jobs, processor, ... }` | `Promise<{ completed, failed }>` | Concurrent batch processing |

**When to use artifacts vs stage output**: Use `io.writeArtifact` for large outputs, model-native text, values needed by multiple stages, or for auditability. Use stage `output` for small structured values needed immediately by the next stage.

---

## LLM API

Available on `llm` object. Call with messages array:

```js
const response = await llm.deepseek.chat({
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: "..." },
  ],
  temperature: 0.7,      // optional: 0-2
  maxTokens: 1000,       // optional
  responseFormat: "json" // optional
});
// Returns: { content: any, usage?: object }
```

### Available Providers
- `llm.deepseek.chat()`
- `llm.anthropic.sonnet45()`
- `llm.openai.gpt5Mini()`
- `llm.gemini.flash25()`

---

## Validation API

Available via `validators` object in stages that need schema validation.

```js
validateWithSchema(schema, data) → { valid: boolean, errors?: AjvError[] }
```

- Accepts string or object (strings parsed as JSON)
- Uses Ajv with `{ allErrors: true, strict: false }`

---

## JSON Schema Export

Tasks export schemas to validate their output:

```js
export const outputSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["content"],
  properties: {
    content: { type: "string", minLength: 1 }
  }
};
```

---

## Seed File Format

Pipeline jobs start from a seed file in `pending/`:

```json
{
  "name": "unique-job-id",
  "pipeline": "pipeline-slug",
  "data": { /* context for tasks */ }
}
```

---

## Context Object Reference

Each stage receives:

```js
{
  io,                    // File I/O (may be null)
  llm,                   // LLM client
  validators,            // { validateWithSchema }
  flags,                 // Control flags
  meta: { taskName, workDir, jobId },
  data: {
    seed,                // Initial payload
    ingestion,           // Output from ingestion
    preProcessing,       // Output from preProcessing
    promptTemplating,    // Output from promptTemplating
    // ... other stage outputs
  },
  output,                // Previous non-validation stage output
}
```

---

## Summary

1. Export only valid stage names: `ingestion`, `preProcessing`, `promptTemplating`, `inference`, `parsing`, `validateStructure`, `validateQuality`, `critique`, `refine`, `finalValidation`, `integration`
2. Return `{ output, flags }` from every stage
3. Custom helper functions are valid JavaScript but will not be called by the pipeline—only use them if called from within a valid stage
4. Most simple tasks need only: `ingestion` → `promptTemplating` → `inference`