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
import { formatOutput } from "./utils/formatters.js";
import { validateData } from "./validators.js";
import { sharedConstants } from "./config/constants.js";

export const ingestion = async (context) => {
  // Use imported utilities
  const formatted = formatOutput(context.data.seed);
  const isValid = validateData(formatted);

  return {
    output: formatted,
    flags: { validationFailed: !isValid },
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
  // Use imported packages
  const processed = lodash.mapValues(context.output, (value) =>
    z.string().parse(value)
  );

  // Make HTTP requests
  const response = await axios.get("https://api.example.com/data");

  return {
    output: {
      ...processed,
      externalData: response.data,
    },
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

  // Use project utilities
  const config = validatePipelineConfig(context.meta);

  // ... rest of implementation

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
│   └── tasks/
│       ├── complex-task.js          # Main task file
│       ├── utils/
│       │   ├── formatters.js        # Relative import
│       │   └── helpers.js           # Relative import
│       └── validators/
│           └── index.js             # Relative import
├── shared/
│   └── common-utilities.js          # Project import
└── package.json                     # Contains your dependencies

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
import { taskSpecificUtil } from './utils/task-util.js';
import { sharedValidator } from '../shared/validators.js';

❌ Avoid
import { taskSpecificUtil } from 'project/pipeline-config/content-generation/tasks/utils/task-util.js';
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

### Common Patterns

#### 1. Shared Utilities Across Tasks

```js
// pipeline-config/shared/utils/data-processing.js
export function cleanText(text) {
  return text.trim().toLowerCase();
}

export function validateStructure(data, schema) {
  // Implementation
}

// pipeline-config/content-generation/tasks/analysis.js
import {
  cleanText,
  validateStructure,
} from "../../shared/utils/data-processing.js";

export const ingestion = async (context) => {
  const cleaned = cleanText(context.data.seed.rawText);
  const isValid = validateStructure(cleaned, expectedSchema);

  return {
    output: { cleanedText: cleaned },
    flags: { validationFailed: !isValid },
  };
};
```

#### 2. Configuration and Constants

```js
// pipeline-config/shared/config/constants.js
export const MODELS = {
  GPT4: "gpt-4",
  CLAUDE: "claude-3-sonnet",
  DEEPSEEK: "deepseek-chat",
};

export const LIMITS = {
  MAX_TOKENS: 4000,
  MAX_RETRIES: 3,
};

// pipeline-config/content-generation/tasks/inference.js
import { MODELS, LIMITS } from "../../shared/config/constants.js";

export const inference = async (context) => {
  const response = await context.llm.openai.gpt4({
    messages: context.data.promptTemplating.messages,
    maxTokens: LIMITS.MAX_TOKENS,
  });

  return {
    output: { response: response.content },
    flags: {},
  };
};
```

#### 3. External API Clients

```js
// pipeline-config/shared/clients/weather-api.js
import axios from "axios";

export class WeatherClient {
  constructor(apiKey) {
    this.client = axios.create({
      baseURL: "https://api.openweathermap.org/data/2.5",
      params: { appid: apiKey },
    });
  }

  async getCurrentWeather(location) {
    const response = await this.client.get("/weather", {
      params: { q: location },
    });
    return response.data;
  }
}

// pipeline-config/content-generation/tasks/weather-research.js
import { WeatherClient } from "../../shared/clients/weather-api.js";

export const ingestion = async (context) => {
  const { location, apiKey } = context.data.seed;
  const client = new WeatherClient(apiKey);

  const weather = await client.getCurrentWeather(location);

  return {
    output: { weatherData: weather },
    flags: {},
  };
};
```

### Troubleshooting Import Issues

#### Module Not Found Errors

If you encounter "Cannot resolve module" errors:

1. **Check relative paths** - Ensure they're relative to your task file
2. **Verify package installation** - Run `npm list <package-name>` in the repo root
3. **Check file extensions** - Use `.js` extensions for ESM imports

#### Symlink Bridge Issues

The symlink bridge is created automatically, but if you encounter issues:

1. **Ensure you're on Linux/macOS** - Windows is not supported
2. **Check filesystem permissions** - Ensure symlink creation is allowed
3. **Verify PO_ROOT environment variable** - Should point to repository root

#### Debugging Import Paths

```js
// Add this to debug import resolution
console.log("Current file URL:", import.meta.url);
console.log("Current directory:", new URL(".", import.meta.url).pathname);

// Test imports with error handling
try {
  const util = await import("./utils/helper.js");
  console.log("Import successful:", util);
} catch (error) {
  console.error("Import failed:", error.message);
}
```

## Best Practices

- Return objects that satisfy the `{ output, flags }` contract.
- Prefer immutability: spread prior output when extending.
- Do NOT rely on `context.output` for prompts in inference—use `context.data.promptTemplating`.
- Include helpful console logging for debugging.
- Use relative imports for task-local code, package imports for external dependencies, and project imports for shared utilities.
