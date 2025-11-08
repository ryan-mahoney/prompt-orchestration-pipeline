# Task Import Guide for LLM Pipeline Creators

## Quick Start: Adding Imports to Your Tasks

This guide shows you how to use external dependencies and shared utilities in your pipeline tasks. The system automatically handles the complex import resolution for you.

### The 3 Types of Imports You Can Use

1. **Relative imports** - Import files from the same task directory
2. **Package imports** - Import npm packages from `node_modules`
3. **Project imports** - Import files from anywhere in your repository

## Step-by-Step Examples

### 1. Using Relative Imports (Most Common)

Perfect for task-specific utilities and helpers.

**Directory Structure:**

```
pipeline-config/content-generation/tasks/
├── my-task.js
├── utils/
│   ├── formatters.js
│   └── validators.js
```

**my-task.js:**

```js
import { formatResearchData } from "./utils/formatters.js";
import { validateInput } from "./utils/validators.js";

export const ingestion = async (context) => {
  const rawData = context.data.seed;

  // Use imported utilities
  const isValid = validateInput(rawData);
  if (!isValid) {
    return {
      output: {},
      flags: { validationFailed: true },
    };
  }

  const formattedData = formatResearchData(rawData);

  return {
    output: formattedData,
    flags: {},
  };
};
```

**utils/formatters.js:**

```js
export function formatResearchData(data) {
  return {
    topic: data.topic?.trim() || "Unknown",
    focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas : [],
    requirements: data.requirements || {},
    timestamp: new Date().toISOString(),
  };
}
```

**utils/validators.js:**

```js
export function validateInput(data) {
  return data && typeof data === "object" && data.topic;
}
```

### 2. Using Package Imports

Perfect for external libraries like Lodash, Axios, Zod, etc.

**First, install the package:**

```bash
npm install lodash axios zod
```

**Then use it in your task:**

```js
import lodash from "lodash";
import axios from "axios";
import { z } from "zod";

// Define a schema for validation
const researchSchema = z.object({
  topic: z.string().min(1),
  focusAreas: z.array(z.string()).optional(),
  requirements: z.record(z.any()).optional(),
});

export const preprocessing = async (context) => {
  try {
    // Validate input with Zod
    const validatedData = researchSchema.parse(context.output);

    // Process with Lodash
    const processedData = lodash.mapValues(validatedData, (value, key) => {
      if (typeof value === "string") {
        return value.toLowerCase().trim();
      }
      return value;
    });

    // Fetch additional data with Axios
    const response = await axios.get("https://api.example.com/context", {
      params: { topic: validatedData.topic },
    });

    return {
      output: {
        ...processedData,
        externalContext: response.data,
      },
      flags: {},
    };
  } catch (error) {
    console.error("Preprocessing failed:", error.message);
    return {
      output: context.output,
      flags: { validationFailed: true },
    };
  }
};
```

### 3. Using Project Imports

Perfect for shared utilities across multiple tasks.

**Create shared utilities:**

```
pipeline-config/shared/
├── utils/
│   ├── logger.js
│   └── data-cleaner.js
├── config/
│   └── constants.js
└── clients/
    └── llm-client.js
```

**shared/utils/logger.js:**

```js
export function createTaskLogger(taskName) {
  return {
    info: (message) => console.log(`[${taskName}] ℹ ${message}`),
    warn: (message) => console.warn(`[${taskName}] ⚠ ${message}`),
    error: (message) => console.error(`[${taskName}] ❌ ${message}`),
    debug: (message) => console.log(`[${taskName}] 🔍 ${message}`),
  };
}
```

**shared/config/constants.js:**

```js
export const LLM_CONFIGS = {
  DEFAULT_MODEL: "gpt-4",
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.7,
  RETRY_ATTEMPTS: 3,
};

export const TASK_TIMEOUTS = {
  INFERENCE: 30000, // 30 seconds
  VALIDATION: 5000, // 5 seconds
};
```

**Use in any task:**

```js
import { createTaskLogger } from "../../shared/utils/logger.js";
import { LLM_CONFIGS, TASK_TIMEOUTS } from "../../shared/config/constants.js";

export const inference = async (context) => {
  const logger = createTaskLogger(context.meta.taskName);

  logger.info("Starting LLM inference");

  try {
    const response = await context.llm.openai.gpt4({
      messages: context.data.promptTemplating.messages,
      maxTokens: LLM_CONFIGS.MAX_TOKENS,
      temperature: LLM_CONFIGS.TEMPERATURE,
      timeout: TASK_TIMEOUTS.INFERENCE,
    });

    logger.info("LLM inference completed successfully");

    return {
      output: {
        llmResponse: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
        },
      },
      flags: {},
    };
  } catch (error) {
    logger.error(`LLM inference failed: ${error.message}`);
    return {
      output: context.output,
      flags: { inferenceFailed: true },
    };
  }
};
```

## Real-World Example: Complete Task with All Import Types

**File structure:**

```
pipeline-config/content-generation/tasks/
├── market-analysis.js
└── utils/
    ├── data-processor.js
    └── report-builder.js

pipeline-config/shared/
├── clients/
│   └── financial-api.js
└── config/
    └── market-constants.js
```

**market-analysis.js:**

```js
import { processMarketData } from "./utils/data-processor.js";
import { buildReport } from "./utils/report-builder.js";
import { FinancialAPIClient } from "../../shared/clients/financial-api.js";
import {
  MARKET_SECTORS,
  ANALYSIS_TYPES,
} from "../../shared/config/market-constants.js";
import axios from "axios";

export const ingestion = async (context) => {
  const { ticker, analysisType } = context.data.seed;

  // Validate input
  if (!ticker || !MARKET_SECTORS.includes(ticker)) {
    return {
      output: {},
      flags: { validationFailed: true },
    };
  }

  return {
    output: { ticker, analysisType },
    flags: {},
  };
};

export const preprocessing = async (context) => {
  const { ticker } = context.output;

  // Use project import for API client
  const apiClient = new FinancialAPIClient(process.env.FINANCIAL_API_KEY);

  // Use package import for external API
  const marketData = await axios.get(
    `https://api.marketdata.com/v1/stocks/${ticker}`
  );
  const companyData = await apiClient.getCompanyProfile(ticker);

  // Use relative import for data processing
  const processedData = processMarketData({
    market: marketData.data,
    company: companyData,
    analysisType: context.output.analysisType,
  });

  return {
    output: processedData,
    flags: {},
  };
};

export const inference = async (context) => {
  const processedData = context.output;

  const response = await context.llm.openai.gpt4({
    messages: [
      {
        role: "system",
        content:
          "You are a financial analyst. Provide detailed market analysis based on the provided data.",
      },
      {
        role: "user",
        content: `Analyze this market data: ${JSON.stringify(processedData, null, 2)}`,
      },
    ],
    maxTokens: 2000,
  });

  return {
    output: {
      ...processedData,
      analysis: response.content,
    },
    flags: {},
  };
};

export const integration = async (context) => {
  const { analysis } = context.output;

  // Use relative import for report building
  const report = buildReport({
    ticker: context.data.seed.ticker,
    analysis,
    timestamp: new Date().toISOString(),
  });

  // Write the final report
  await context.io.writeArtifact(
    "market-analysis-report.json",
    JSON.stringify(report, null, 2)
  );

  return {
    output: report,
    flags: {},
  };
};
```

## Common Import Patterns

### Pattern 1: Configuration Management

```js
// shared/config/task-config.js
export const TASK_CONFIG = {
  models: {
    analysis: "gpt-4",
    summarization: "gpt-3.5-turbo",
  },
  timeouts: {
    short: 5000,
    medium: 30000,
    long: 120000,
  },
};

// In any task
import { TASK_CONFIG } from "../../shared/config/task-config.js";

export const inference = async (context) => {
  const model = TASK_CONFIG.models.analysis;
  const timeout = TASK_CONFIG.timeouts.medium;

  // ... use config values
};
```

### Pattern 2: Error Handling Utilities

```js
// shared/utils/error-handler.js
export function createTaskErrorHandler(taskName) {
  return {
    handleValidationError: (error) => {
      console.error(`[${taskName}] Validation Error: ${error.message}`);
      return {
        flags: { validationFailed: true, lastValidationError: error.message },
      };
    },

    handleInferenceError: (error) => {
      console.error(`[${taskName}] Inference Error: ${error.message}`);
      return { flags: { inferenceFailed: true } };
    },

    handleGenericError: (error) => {
      console.error(`[${taskName}] Error: ${error.message}`);
      return { flags: { failed: true } };
    },
  };
}

// In task
import { createTaskErrorHandler } from "../../shared/utils/error-handler.js";

export const inference = async (context) => {
  const errorHandler = createTaskErrorHandler(context.meta.taskName);

  try {
    const response = await context.llm.openai.gpt4(/* ... */);
    return { output: response.content, flags: {} };
  } catch (error) {
    return errorHandler.handleInferenceError(error);
  }
};
```

### Pattern 3: Data Transformation Pipeline

```js
// shared/transforms/data-pipeline.js
export function createTransformPipeline(...transforms) {
  return async (data) => {
    let result = data;
    for (const transform of transforms) {
      result = await transform(result);
    }
    return result;
  };
}

// shared/transforms/basic-transforms.js
export const normalizeText = (data) => ({
  ...data,
  text: data.text?.toLowerCase().trim() || "",
});

export const validateRequired = (fields) => (data) => {
  const missing = fields.filter((field) => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
  return data;
};

// In task
import { createTransformPipeline } from "../../shared/transforms/data-pipeline.js";
import {
  normalizeText,
  validateRequired,
} from "../../shared/transforms/basic-transforms.js";

export const preprocessing = async (context) => {
  const pipeline = createTransformPipeline(
    normalizeText,
    validateRequired(["topic", "description"])
  );

  try {
    const processed = await pipeline(context.output);
    return { output: processed, flags: {} };
  } catch (error) {
    return {
      output: context.output,
      flags: { validationFailed: true, lastValidationError: error.message },
    };
  }
};
```

## Troubleshooting Quick Reference

| Problem                                    | Solution                                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| "Cannot resolve module"                    | Check file paths and ensure `.js` extension is included          |
| "Module not found" for npm package         | Run `npm install <package-name>` in repo root                    |
| Import works locally but fails in pipeline | Check if you're on Linux/macOS (symlink bridge requirement)      |
| Relative import path not working           | Verify path is relative to your task file location               |
| Project import not working                 | Use `project/` prefix: `import X from 'project/path/to/file.js'` |

## Best Practices Summary

1. **Organize imports by type**: relative → packages → project
2. **Use descriptive imports**: Import only what you need
3. **Handle import errors gracefully**: Use try/catch for external dependencies
4. **Keep task files focused**: Move complex logic to shared utilities
5. **Document your imports**: Comment why each import is needed
6. **Test imports locally**: Verify your task works before pipeline execution

## Next Steps

1. Try the examples above in your own tasks
2. Create shared utilities for common patterns in your pipeline
3. Explore the package ecosystem for useful libraries
4. Check the [Task Development Guide](./task-development-guide.md) for more detailed information

The symlink bridge system handles all the complex import resolution automatically, so you can focus on building powerful pipeline tasks!
