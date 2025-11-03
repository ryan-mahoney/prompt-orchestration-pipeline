# Pipeline Task Authoring Guidelines

This guide establishes conventions for implementing pipeline stages that interoperate cleanly with the task runner.

## Stage Shape and Signature

- Export each stage as a named function (one per stage).
- Accept a single destructured parameter with standard keys:
  - io: artifact I/O interface with async read/write methods.
  - llm: provider bag; destructure the model you need (e.g., { deepseek }).
  - data: seed input and prior stage outputs.
  - meta: runtime metadata (reserved for platform use).
  - flags: cross-stage configuration and status signals.

Synchronous stage:

```js
export const ingestion = ({ io, llm, data, meta, flags }) => ({
  output: {
    /* derived fields */
  },
  flags, // pass-through unless augmented
});
```

Asynchronous stage:

```js
export const inference = async ({ io, llm, data, meta, flags }) => {
  // side-effects and network calls allowed
  return { output: {}, flags };
};
```

Return contract (all stages):

- Return an object with:
  - output: plain, JSON-serializable values for downstream stages.
  - flags: pass-through or augmented copy (do not mutate in place).

## Data Flow and Contracts

- Read seed input from data.seed.data in the first stage that needs it.
- Read prior stage outputs via data.<stageName>.
- Do not import earlier stage modules; rely on the runner-supplied data graph.
- Prefer small, stable output objects between stages; use artifacts for large or opaque payloads.

## Flags and Control Flow

- Treat flags as the side-channel for control signals across stages.
- Pass through unchanged when not modified:
  ```js
  return { output, flags };
  ```
- Augment to signal downstream behavior:
  ```js
  return { output: {}, flags: { ...flags, validationFailed: true } };
  ```
- Prefer flagging over throwing in validation stages; allow the orchestrator to decide next steps.

## Using io (Artifacts)

- Persist model outputs or large data using io.writeArtifact(fileName, stringContent).
- Load persisted content with io.readArtifact(fileName).
- Artifacts are strings; serialize/deserialize JSON explicitly.
- Choose consistent, task-scoped filenames shared by producer/consumer stages.
- Suggested serialization policy:
  ```js
  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  await io.writeArtifact("task-output.json", content);
  ```

When to use artifacts vs stage output:

- Stage output: small, structured values needed immediately by the next stage.
- Artifacts: large outputs, model-native text, or values needed by multiple stages and for auditability.

## Using llm (Prompting and Inference) with deepseek

Separation of concerns:

- A “templating” stage builds prompts (system + user).
- An “inference” stage calls the model.

Prompt templating:

- Produce explicit system and user prompt strings.
- If machine parsing is required, include JSON-only instructions and list required fields and formatting constraints (quoted strings, no trailing commas, properly nested brackets/braces, valid escape sequences).
- Personalize prompts from prior stage outputs:
  ```js
  const prompt = `Do X with:
  ${items.map((i) => `- ${i}`).join("\n")}
  Return only valid JSON with fields: ...`;
  ```

Inference (deepseek):

- Select deepseek from llm via destructuring:
  ```js
  export const inference = async ({
    io,
    llm: { deepseek },
    data: {
      promptTemplating: { system, prompt },
    },
    flags,
  }) => {
    const response = await deepseek.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    await io.writeArtifact("task-output.json", content);
    return { output: {}, flags };
  };
  ```
- Persist response content to an artifact as a string (see serialization policy above).

## Validation

- Read the artifact and attempt JSON.parse inside try/catch.
- Validate presence of required fields; avoid throwing for validation failures.
- Set a boolean-like flag (e.g., validationFailed) to guide downstream behavior.
- Prefer console.warn with clear, stage-tagged context on parse failures:
  ```js
  console.warn("[validateStructure] ⚠ JSON parsing failed:", err.message);
  ```

## Side-effects vs Pure Logic

- Pure stages (e.g., ingestion, templating) should be synchronous when possible and free of I/O.
- Side-effecting stages (e.g., inference, validation that reads/writes artifacts) should be async and isolate I/O and networking.
- Keep pure computations deterministic and keep their outputs small and stable.

## Naming and Structure

- Use camelCase export names that describe the purpose: ingestion, promptTemplating, inference, validateStructure, etc.
- Use concise, consistent output key names.
- Inline “Step N” comments are optional but can increase readability.

## Example Skeleton

```js
export const ingestion = ({
  data: {
    seed: { data: seed },
  },
  flags,
}) => {
  const { inputs, constraints } = seed;
  return { output: { inputs, constraints }, flags };
};

export const promptTemplating = ({
  data: {
    ingestion: { inputs },
  },
  flags,
}) => {
  const system = "You are an assistant. Respond with valid JSON only.";
  const prompt = `Process the following:\n${inputs.map((v) => `- ${v}`).join("\n")}\n\nReturn JSON with fields: ...`;
  return { output: { system, prompt }, flags };
};

export const inference = async ({
  io,
  llm: { deepseek },
  data: {
    promptTemplating: { system, prompt },
  },
  flags,
}) => {
  const response = await deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  await io.writeArtifact("task-output.json", content);
  return { output: {}, flags };
};

export const validateStructure = async ({ io, flags }) => {
  const raw = await io.readArtifact("task-output.json");
  let jsonValid = false,
    structureValid = false;
  try {
    const parsed = JSON.parse(raw);
    jsonValid = true;
    const required = ["fieldA", "fieldB", "fieldC"];
    structureValid = required.every((k) => Object.hasOwn(parsed, k));
  } catch (err) {
    console.warn("[validateStructure] ⚠ JSON parsing failed:", err.message);
  }
  return {
    output: {},
    flags: { ...flags, validationFailed: !(jsonValid && structureValid) },
  };
};
```

## Practical Notes

- Keep prompts strict when you require machine-parseable responses; validate strictly in a dedicated stage.
- Prefer artifacts for model outputs to support auditing, retries, and post-hoc validation without recomputation.
- Never mutate flags in place; always return a new object when augmenting (e.g., { ...flags, ... }).
- Ensure consistent serialization before writing artifacts; parse defensively when reading.
