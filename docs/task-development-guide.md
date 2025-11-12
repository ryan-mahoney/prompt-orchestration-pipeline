# Task Development Guide

## Overview

This guide explains how to implement pipeline task stages that work correctly with the task-runner context model. Each task file is a Node.js executable JavaScript file that exports a standard set of functions for doing one stage of sequential task work as part of an overall LLM pipeline, along with permissive JSON schemas for the file formats that they write.

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
    parsing?: output,
    validateStructure?: output,
    validateQuality?: output,
    critique?: output,
    refine?: output,
    finalValidation?: output,
    integration?: output,
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
- **JSON Schema validation**: Tasks export JSON schemas that define the structure of their output files.

## Available Stages

### Core Stages

1. **ingestion** - Load and prepare input data
2. **preProcessing** - Optional normalization/enrichment of input data
3. **promptTemplating** - Build LLM prompts
4. **inference** - Call LLM with prompts
5. **parsing** - Parse/normalize LLM output into structured shape (optional)
6. **validateStructure** - Validate response structure using JSON schema
7. **validateQuality** - Domain-specific quality validation (optional)

### Refinement Stages

8. **critique** - Analyze validation failures and propose improvements (optional)
9. **refine** - Apply critique to produce improved output (optional)
10. **finalValidation** - Ensure refined output satisfies all constraints (optional)
11. **integration** - Persist, organize, or hand off final results

## Stage-by-Stage Implementation

### Ingestion

Reads from `context.data.seed` and prepares input data for processing:

```js
export const ingestion = async ({
  io,
  llm,
  data: {
    seed: {
      data: { topic, focusAreas, requirements },
    },
  },
  meta,
  flags,
}) => {
  return {
    output: {
      topic,
      focusAreas,
      requirements,
    },
    flags,
  };
};
```

### PreProcessing

Optional stage for normalizing or preparing data for prompt creation:

```js
export const preProcessing = ({
  io,
  llm,
  data: { ingestion },
  meta,
  flags,
  output,
}) => {
  return {
    output: output ?? ingestion,
    flags,
  };
};
```

### PromptTemplating

Builds LLM prompts with system and user messages:

```js
export const promptTemplating = ({
  io,
  llm,
  data: {
    ingestion: { focusAreas, topic },
  },
  meta,
  flags,
}) => {
  return {
    output: {
      system:
        "You are a research assistant specializing in comprehensive information gathering. Always respond with valid JSON only.",
      prompt: `Research the following topic: ${topic}

Focus areas:
${focusAreas.map((area) => `- ${area}`).join("\n")}

IMPORTANT: You must respond with a valid JSON object only. Do not include any text before or after the JSON. Your response should follow this exact structure:

{
  "researchSummary": "Brief overview of the research findings",
  "keyFindings": [
    {
      "area": "name of focus area",
      "findings": "detailed information about this area",
      "sources": ["source1", "source2"] (optional)
    }
  ]
}

Now provide your research findings in the specified JSON format:`,
    },
    flags,
  };
};
```

### Inference

Calls LLM with the prepared prompts. **IMPORTANT**: Read prompts **only** from `context.data.promptTemplating`:

```js
export const inference = async ({
  io,
  llm: { deepseek },
  data: {
    promptTemplating: { system, prompt },
  },
  meta,
  flags,
}) => {
  const response = await deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  // Normalize model output to ensure canonical JSON object
  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  await io.writeArtifact(
    "research-output.json",
    JSON.stringify(parsed, null, 2)
  );

  return {
    output: {},
    flags,
  };
};
```

### Validation Stages

#### validateStructure

Validates the response structure using JSON schema:

```js
export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const researchContent = await io.readArtifact("research-output.json");
  const result = validateWithSchema(researchJsonSchema, researchContent);

  if (!result.valid) {
    console.warn(
      "[Research:validateStructure] Validation failed",
      result.errors
    );
    return {
      output: {},
      flags: { ...flags, validationFailed: true },
    };
  }

  return {
    output: {},
    flags,
  };
};
```

#### validateQuality

Domain-specific quality validation that can trigger refinement:

```js
export const validateQuality = ({ io, llm, data, meta, flags, output }) => {
  return {
    output: {
      feedback:
        "Research must include an additional negative or critical information.",
    },
    flags: { needsRefinement: true },
  };
};
```

### Refinement Stages

#### critique

Analyzes validation failures and proposes improvements:

```js
export const critique = async ({
  io,
  llm: { anthropic },
  data: {
    validateQuality: { feedback },
    promptTemplating: { prompt },
  },
  meta,
  flags,
  output,
}) => {
  const template = {
    system:
      "You are an expert in research analysis who can look at an LLM prompt, see its shortcomings, and suggest improvements. Always respond with valid JSON only.",
    prompt: `ORIGINAL_PROMPT: ${prompt}

FEEDBACK: ${feedback}

INSTRUCTIONS: Based on the ORIGINAL_PROMPT and FEEDBACK, generate a new prompt in JSON format that addresses the feedback while maintaining the original intent.

OUTPUT FORMAT:
{
  "prompt": "string"
}`,
  };

  const response = await anthropic.sonnet45({
    messages: [
      { role: "system", content: template.system },
      { role: "user", content: JSON.stringify(template) },
    ],
  });

  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  return {
    output: {
      revisedPrompt: parsed.prompt,
    },
    flags,
  };
};
```

#### refine

Applies critique to produce improved output:

```js
export const refine = async ({
  io,
  llm: { deepseek },
  data: {
    critique: { revisedPrompt },
    promptTemplating: { system },
  },
  meta,
  flags,
  output,
}) => {
  const response = await deepseek.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: revisedPrompt },
    ],
  });

  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  await io.writeArtifact(
    "research-output-2.json",
    JSON.stringify(parsed, null, 2)
  );

  return {
    output,
    flags,
  };
};
```

#### finalValidation

Ensures refined output satisfies all constraints:

```js
export const finalValidation = async ({
  io,
  llm,
  data,
  meta,
  flags,
  output,
  validators: { validateWithSchema },
}) => {
  const researchContent = await io.readArtifact("research-output-2.json");
  const result = validateWithSchema(researchJsonSchema, researchContent);

  if (!result.valid) {
    console.warn("[Research:finalValidation] Validation failed", result.errors);
    throw new Error(
      `Final schema validation failed: ${JSON.stringify(result.errors)}`
    );
  }

  await io.writeArtifact("research-output.json", researchContent);

  return {
    output: {},
    flags,
  };
};
```

### Integration

Final stage for persisting or handing off results:

```js
export const integration = ({ io, llm, data, meta, flags, output }) => {
  return {
    output,
    flags,
  };
};
```

## JSON Schemas

Each task file exports a JSON schema that defines the structure of its output files:

```js
export const researchJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: [
    "researchSummary",
    "keyFindings",
    "additionalInsights",
    "researchCompleteness",
  ],
  properties: {
    researchSummary: {
      type: "string",
      minLength: 1,
    },
    keyFindings: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["area", "findings"],
        properties: {
          area: {
            type: "string",
            minLength: 1,
          },
          findings: {
            type: "string",
            minLength: 1,
          },
          sources: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
    },
    additionalInsights: {
      type: "string",
    },
    researchCompleteness: {
      type: "string",
      minLength: 1,
    },
  },
};
```

## File I/O

When `context.io` is available, you can read and write artifacts:

```js
// Write an artifact
await io.writeArtifact("filename.json", JSON.stringify(data, null, 2));

// Read an artifact
const content = await io.readArtifact("research-output.json");
const parsed = JSON.parse(content);
```

## Available LLM Providers

The context.llm object provides access to configured LLM providers:

```js
// Available providers based on current implementation
llm.deepseek.chat(options);
llm.gemini.flash25(options);
llm.anthropic.sonnet45(options);
llm.openai.gpt5Mini(options);
```

## Task Organization

Tasks are organized in a directory structure with an index.js file that maps task names to their implementations:

```js
// tasks/index.js
export default {
  research: "./research.js",
  analysis: "./analysis.js",
  formatting: "./formatting.js",
  synthesis: "./synthesis.js",
};
```

The pipeline.json file defines the task execution order:

```json
{
  "name": "content-generation",
  "version": "1.0.0",
  "description": "Demo pipeline showcasing multi-stage LLM workflows",
  "tasks": ["research", "analysis", "synthesis", "formatting"]
}
```

## Importing Dependencies in Tasks

### Overview

Tasks execute in per-job working directories that are isolated from the main repository. To ensure reliable access to dependencies, the pipeline automatically creates a **symlink bridge** that provides:

- `node_modules/` → Links to the repository's `node_modules`
- `project/` → Links to the repository root directory
- `_task_root/` → Links to the original task source directory

This allows you to use both relative imports and package imports reliably.

### What You Can Import

#### 1. Relative Imports (Sibling Files)

You can import files that are co-located with your task:

```js
// File: pipeline-config/content-generation/tasks/complex-task.js
import { test } from "../libs/test.js";

export const promptTemplating = ({ data, flags }) => {
  test();
  return {
    output: { system: "...", prompt: "..." },
    flags,
  };
};
```

#### 2. Package Imports (node_modules)

You can import any package installed in the repository:

```js
import lodash from "lodash";
import { z } from "zod";
import axios from "axios";

export const preprocessing = async (context) => {
  const processed = lodash.mapValues(context.output, (value) =>
    z.string().parse(value)
  );

  return {
    output: processed,
    flags: {},
  };
};
```

#### 3. Project-Wide Imports

You can import utilities from anywhere in the project:

```js
// Import from project root
import { createLogger } from "project/src/utils/logger.js";
import { validatePipelineConfig } from "project/src/config/validator.js";

export const inference = async (context) => {
  const logger = createLogger(context.meta.taskName);
  logger.info("Starting inference stage");

  const config = validatePipelineConfig(context.meta);

  return {
    output: result,
    flags: {},
  };
};
```

### File Structure Example

```
pipeline-config/
├── content-generation/
│   ├── tasks/
│   │   ├── index.js              # Task mapping
│   │   ├── research.js           # Main task file
│   │   ├── analysis.js
│   │   ├── synthesis.js
│   │   ├── formatting.js
│   │   └── libs/
│   │       └── test.js           # Shared utilities
│   └── pipeline.json             # Pipeline definition
├── shared/
│   └── common-utilities.js       # Project import
└── package.json                  # Contains dependencies

# During execution, the symlink bridge creates:
# job-workspace/{jobId}/tasks/complex-task/
# ├── node_modules/ -> ../../../node_modules/
# ├── project/ -> ../../../
# ├── _task_root/ -> pipeline-config/content-generation/tasks/
# └── complex-task.js (copied and executed from here)
```

### Best Practices for Imports

#### 1. Use Relative Imports for Task-Local Code

```js
✅ Good
import { test } from '../libs/test.js';

❌ Avoid
import { test } from 'project/pipeline-config/content-generation/libs/test.js';
```

#### 2. Use Package Imports for External Dependencies

```js
✅ Good
import lodash from 'lodash';
import { z } from 'zod';

❌ Avoid relative imports to node_modules
import lodash from '../../../node_modules/lodash/index.js';
```

#### 3. Use Project Imports for Shared Code

```js
✅ Good
import { pipelineLogger } from 'project/src/utils/logging.js';
import { configValidator } from 'project/src/config/validator.js';
```

## Error Handling

- Throw descriptive errors for missing required data
- Use try/catch and re-throw with context
- Log failures via console.error
- Validate JSON structure and handle parsing errors gracefully

```js
export const inference = async ({ io, llm, data, flags }) => {
  try {
    const response = await llm.deepseek.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });

    let parsed;
    if (typeof response.content === "string") {
      parsed = JSON.parse(response.content);
    } else if (
      typeof response.content === "object" &&
      response.content !== null
    ) {
      parsed = response.content;
    } else {
      throw new Error(
        "LLM response content must be a JSON object or a JSON stringified object"
      );
    }

    await io.writeArtifact("output.json", JSON.stringify(parsed, null, 2));
    return { output: {}, flags };
  } catch (error) {
    console.error("Inference failed:", error.message);
    throw error;
  }
};
```

## Best Practices

- Return objects that satisfy the `{ output, flags }` contract
- Prefer immutability: spread prior output when extending
- Do NOT rely on `context.output` for prompts in inference—use `context.data.promptTemplating`
- Include helpful console logging for debugging
- Use relative imports for task-local code, package imports for external dependencies, and project imports for shared utilities
- Always validate JSON responses and handle parsing errors
- Write meaningful artifacts that can be used for debugging and downstream processing
