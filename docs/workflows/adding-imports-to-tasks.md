# Workflow: Adding Imports to Pipeline Tasks

This workflow guides you through adding import functionality to existing tasks or creating new tasks with external dependencies.

## When to Use This Workflow

Use this workflow when you need to:

- Add external npm packages to your pipeline tasks
- Create shared utilities across multiple tasks
- Refactor existing tasks to use relative imports
- Add project-wide configuration or constants
- Integrate external APIs or services

## Prerequisites

- You're working on Linux/macOS (required for symlink bridge)
- You have access to the repository root
- npm packages are installed in the repository root
- Task files follow ESM module format (`.js` extensions required)

## Step 1: Planning Your Import Strategy

### 1.1 Analyze Your Dependencies

Ask yourself:

- Is this utility **task-specific** or **shared across tasks**?
- Is this an **external npm package** or **internal code**?
- Will this dependency be used by **one task** or **many tasks**?

### 1.2 Choose the Right Import Type

| Use Case                | Import Type     | Example                                          |
| ----------------------- | --------------- | ------------------------------------------------ |
| Task-specific utilities | Relative import | `import { util } from './utils/helper.js'`       |
| External libraries      | Package import  | `import lodash from 'lodash'`                    |
| Shared utilities        | Project import  | `import { util } from 'project/shared/utils.js'` |

### 1.3 Plan Your File Structure

```
pipeline-config/
├── your-pipeline/
│   └── tasks/
│       ├── your-task.js
│       └── utils/              # Task-specific (relative imports)
│           └── helper.js
└── shared/                     # Project-wide (project imports)
    ├── utils/
    ├── config/
    └── clients/
```

## Step 2: Setting Up Dependencies

### 2.1 Install npm Packages (if needed)

```bash
# From repository root
npm install package-name
npm install --save-dev package-name  # For dev dependencies
```

### 2.2 Create Shared Utilities (if needed)

```bash
# Create shared directory structure
mkdir -p pipeline-config/shared/utils
mkdir -p pipeline-config/shared/config
mkdir -p pipeline-config/shared/clients
```

### 2.3 Create Task-Specific Utilities (if needed)

```bash
# Create task utilities
mkdir -p pipeline-config/your-pipeline/tasks/utils
```

## Step 3: Implementing the Imports

### 3.1 Add Relative Imports

Create utility files alongside your task:

```js
// pipeline-config/your-pipeline/tasks/utils/data-formatter.js
export function formatInput(data) {
  return {
    ...data,
    processed: true,
    timestamp: new Date().toISOString(),
  };
}

// pipeline-config/your-pipeline/tasks/your-task.js
import { formatInput } from "./utils/data-formatter.js";

export const ingestion = async (context) => {
  const formatted = formatInput(context.data.seed);
  return {
    output: formatted,
    flags: {},
  };
};
```

### 3.2 Add Package Imports

Use external libraries in your task:

```js
// pipeline-config/your-pipeline/tasks/your-task.js
import axios from "axios";
import { z } from "zod";

export const preprocessing = async (context) => {
  // Use zod for validation
  const schema = z.object({
    topic: z.string().min(1),
    requirements: z.record(z.any()).optional(),
  });

  const validated = schema.parse(context.output);

  // Use axios for external API calls
  const response = await axios.get("https://api.example.com/data", {
    params: { topic: validated.topic },
  });

  return {
    output: {
      ...validated,
      externalData: response.data,
    },
    flags: {},
  };
};
```

### 3.3 Add Project Imports

Create and use shared utilities:

```js
// pipeline-config/shared/utils/logger.js
export function createLogger(taskName) {
  return {
    info: (msg) => console.log(`[${taskName}] ${msg}`),
    error: (msg) => console.error(`[${taskName}] ${msg}`),
  };
}

// pipeline-config/shared/config/constants.js
export const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 30000,
  MODELS: {
    PRIMARY: "gpt-4",
    FALLBACK: "gpt-3.5-turbo",
  },
};

// pipeline-config/your-pipeline/tasks/your-task.js
import { createLogger } from "../../../shared/utils/logger.js";
import { CONFIG } from "../../../shared/config/constants.js";

export const inference = async (context) => {
  const logger = createLogger(context.meta.taskName);

  logger.info("Starting inference");

  try {
    const response = await context.llm.openai.gpt4({
      messages: context.data.promptTemplating.messages,
      timeout: CONFIG.TIMEOUT,
    });

    logger.info("Inference completed");

    return {
      output: { response: response.content },
      flags: {},
    };
  } catch (error) {
    logger.error(`Inference failed: ${error.message}`);
    return {
      output: context.output,
      flags: { inferenceFailed: true },
    };
  }
};
```

## Step 4: Testing Your Implementation

### 4.1 Local Testing

Test your task locally to verify imports work:

```bash
# Run the pipeline with your task
npm run pipeline -- --pipeline your-pipeline --seed your-seed.json
```

### 4.2 Import Validation

Add debug logging to verify imports:

```js
// At the top of your task file
console.log("Import test - utils loaded:", !!formatInput);
console.log("Import test - packages loaded:", !!axios && !!z);
console.log("Import test - shared loaded:", !!createLogger && !!CONFIG);
```

### 4.3 Error Handling Testing

Test error scenarios:

```js
// Test import failures
try {
  const { formatInput } = await import("./utils/data-formatter.js");
  console.log("Relative import successful");
} catch (error) {
  console.error("Relative import failed:", error.message);
}

try {
  const axios = await import("axios");
  console.log("Package import successful");
} catch (error) {
  console.error("Package import failed:", error.message);
}
```

## Step 5: Common Patterns and Examples

### Pattern 1: Configuration Management

```js
// shared/config/pipeline-config.js
export const PIPELINE_CONFIG = {
  models: {
    analysis: "gpt-4",
    summarization: "gpt-3.5-turbo",
  },
  timeouts: {
    inference: 30000,
    validation: 5000,
  },
  retries: {
    max: 3,
    backoff: 1000,
  },
};

// In task
import { PIPELINE_CONFIG } from "../../../shared/config/pipeline-config.js";

export const inference = async (context) => {
  const response = await context.llm.openai.gpt4({
    messages: context.data.promptTemplating.messages,
    timeout: PIPELINE_CONFIG.timeouts.inference,
  });

  return { output: { response: response.content }, flags: {} };
};
```

### Pattern 2: Error Handling Utilities

```js
// shared/utils/error-handler.js
export function createTaskErrorHandler(taskName) {
  return {
    wrap: async (fn, context) => {
      try {
        return await fn(context);
      } catch (error) {
        console.error(`[${taskName}] Error:`, error.message);
        return {
          output: context.output,
          flags: { failed: true, error: error.message },
        };
      }
    },
  };
}

// In task
import { createTaskErrorHandler } from "../../../shared/utils/error-handler.js";

export const preprocessing = createTaskErrorHandler("my-task").wrap(
  async (context) => {
    // Your preprocessing logic here
    return { output: processedData, flags: {} };
  }
);
```

### Pattern 3: Data Validation Pipeline

```js
// shared/validators/data-validator.js
export const validators = {
  validateString: (value, minLength = 1) =>
    typeof value === "string" && value.length >= minLength,

  validateArray: (value, minItems = 0) =>
    Array.isArray(value) && value.length >= minItems,

  validateObject: (value, requiredKeys = []) =>
    typeof value === "object" &&
    requiredKeys.every((key) => value.hasOwnProperty(key)),
};

export function createSchema(schema) {
  return (data) => {
    const errors = [];

    for (const [key, rules] of Object.entries(schema)) {
      const value = data[key];

      if (rules.required && (value === undefined || value === null)) {
        errors.push(`${key} is required`);
        continue;
      }

      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`${key} must be of type ${rules.type}`);
      }

      if (rules.minLength && value.length < rules.minLength) {
        errors.push(`${key} must be at least ${rules.minLength} characters`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  };
}

// In task
import { createSchema } from "../../../shared/validators/data-validator.js";

const seedSchema = createSchema({
  topic: { required: true, type: "string", minLength: 3 },
  focusAreas: { required: false, type: "object" },
});

export const ingestion = async (context) => {
  const validation = seedSchema(context.data.seed);

  if (!validation.valid) {
    return {
      output: {},
      flags: {
        validationFailed: true,
        validationErrors: validation.errors,
      },
    };
  }

  return {
    output: context.data.seed,
    flags: {},
  };
};
```

## Step 6: Troubleshooting

### Common Issues and Solutions

| Issue                                      | Cause                   | Solution                           |
| ------------------------------------------ | ----------------------- | ---------------------------------- |
| "Cannot resolve module"                    | Incorrect relative path | Check path from task file location |
| "Module not found"                         | Package not installed   | Run `npm install package-name`     |
| Import works locally but fails in pipeline | Not on Linux/macOS      | Use Linux/macOS environment        |
| Symlink errors                             | Filesystem permissions  | Check symlink creation permissions |
| Circular dependencies                      | Import cycles           | Restructure code to avoid cycles   |

### Debug Steps

1. **Verify file structure**: Check that files exist at expected paths
2. **Test imports individually**: Use dynamic imports to test
3. **Check npm packages**: Verify packages are in `node_modules`
4. **Environment check**: Ensure you're on supported OS
5. **Permissions check**: Verify symlink creation is allowed

## Step 7: Best Practices

### Do's

- ✅ Use relative imports for task-specific code
- ✅ Use package imports for external libraries
- ✅ Use project imports for shared utilities
- ✅ Add error handling for external dependencies
- ✅ Include `.js` extensions in all imports
- ✅ Test imports locally before pipeline execution
- ✅ Document complex import logic

### Don'ts

- ❌ Mix import types in confusing ways
- ❌ Use relative paths to `node_modules`
- ❌ Assume imports work without testing
- ❌ Create circular dependencies
- ❌ Ignore import errors in production
- ❌ Use absolute paths for task-local files

## Step 8: Validation Checklist

Before submitting your changes:

- [ ] All imports use `.js` extensions
- [ ] Relative paths are correct for task location
- [ ] Package imports are installed in repository root
- [ ] Shared utilities are in `pipeline-config/shared/`
- [ ] Error handling covers import failures
- [ ] Testing verifies imports work correctly
- [ ] Documentation explains import usage
- [ ] No circular dependencies exist

## Step 9: Submitting Changes

### Commit Message Format

```
feat(pipeline): add import support for external dependencies

- Add relative imports for task-specific utilities
- Integrate npm packages (axios, zod) for data processing
- Create shared utilities for logging and configuration
- Add error handling for import failures

Closes #issue-number
```

### PR Description

```markdown
# Why

Tasks needed access to external dependencies and shared utilities to improve code reusability and functionality.

# What Changed

- Added relative imports for task-specific utilities
- Integrated external packages (axios, zod) for enhanced data processing
- Created shared utilities in `pipeline-config/shared/`
- Added comprehensive error handling for import failures

# How Was This Tested

- Local pipeline execution with new imports
- Import error simulation and handling verification
- Cross-task sharing validation
- Package dependency resolution testing

# Risks & Rollback

- Risk: Import resolution failures on non-POSIX systems
- Mitigation: Documentation clearly states Linux/macOS requirement
- Rollback: Revert to inline implementations if issues arise

# Checklist

- [x] All imports tested locally
- [x] Error handling implemented
- [x] Documentation updated
- [x] No breaking changes to existing tasks
```

## Additional Resources

- [Task Development Guide](../task-development-guide.md)
- [Task Import Guide](../task-import-guide.md)
- [Import Implementation Plan](../import-plan.md)
- [Pipeline Architecture](../architecture.md)

This workflow ensures you can safely and effectively add import functionality to your pipeline tasks while maintaining reliability and best practices.
