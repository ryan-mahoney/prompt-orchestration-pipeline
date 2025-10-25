# Task Development Guide

## Overview

This guide explains how to create and maintain task handlers for the prompt orchestration pipeline. Task handlers are individual functions that process data through specific stages of a pipeline, following a strict contract for input and output.

## New Handler Contract

All task handlers must follow the new `{ output, flags }` contract introduced in the task runner refactor.

### Function Signature

```javascript
async function stageName(context) {
  // Handler implementation
  return {
    output: <any JSON-compatible value>,
    flags: <plain object with flag updates>
  };
}
```

### Context Structure

The `context` parameter provides access to pipeline data and utilities:

```javascript
{
  // Utilities (now at top level)
  io: FileIO instance,
  llm: LLM instance,

  // Meta information
  meta: {
    taskName: string,
    workDir: string,
    statusPath: string,
    jobId: string,
    envLoaded: boolean,
    modelConfig: object
  },

  // Data from previous stages and initial seed
  data: {
    seed: <initial seed data>,
    <previousStageName>: <output from previous stage>,
    // ... other stage outputs
  },

  // Current flag state (read-only for handlers)
  flags: {
    <flagName>: <flagValue>,
    // ... accumulated flags from previous stages
  },

  // Current stage being executed
  currentStage: string
}
```

### Return Value Structure

Handlers must return an object with exactly two properties:

```javascript
{
  output: <any JSON-compatible value>,
  flags: <plain object>
}
```

- **`output`**: Any JSON-serializable value representing the stage's result
- **`flags`**: Plain object containing flag updates for the pipeline

## Accessing Pipeline Data

### Reading Input Data

```javascript
async function validateStructure(context) {
  // Access the initial seed data
  const seed = context.data.seed;

  // Access output from previous stages
  const ingestionResult = context.data.ingestion;
  const preprocessingResult = context.data.preProcessing;

  // Read current flag state
  const validationFailed = context.flags.validationFailed;

  // Use utilities directly from context
  const { io, llm } = context;

  return {
    output: { validationPassed: true },
    flags: { validationFailed: false },
  };
}
```

### Using Utilities

```javascript
async function inference(context) {
  const { io, llm } = context;
  const prompt = context.data.promptTemplating;

  const result = await llm.complete(prompt);

  return {
    output: { result: result.text },
    flags: { inferenceComplete: true },
  };
}
```

## Flag Management

### Setting Flags

Flags communicate state between stages and control pipeline flow:

```javascript
async function critique(context) {
  const validationResult = context.data.validateStructure;

  if (validationResult.validationPassed) {
    return {
      output: { critique: "No issues found" },
      flags: {
        critiqueComplete: true,
        needsRefinement: false,
      },
    };
  } else {
    return {
      output: { critique: "Issues detected" },
      flags: {
        critiqueComplete: true,
        needsRefinement: true,
      },
    };
  }
}
```

### Reading Flags

```javascript
async function refine(context) {
  // Check if refinement is needed based on previous flags
  const needsRefinement = context.flags.needsRefinement;
  const critiqueComplete = context.flags.critiqueComplete;

  if (!needsRefinement || !critiqueComplete) {
    return {
      output: { refined: false, reason: "no refinement needed" },
      flags: { refined: false },
    };
  }

  // Perform refinement logic...

  return {
    output: { refined: true, improvedContent: "..." },
    flags: { refined: true },
  };
}
```

## Standard Stage Patterns

### Validation Stages

Validation stages check data quality and set flags that control refinement:

```javascript
async function validateStructure(context) {
  const { io } = context;
  const content = context.data.parsing;

  try {
    // Perform validation logic
    const isValid = validateSchema(content);

    if (!isValid) {
      return {
        output: {
          validationPassed: false,
          errors: ["Schema validation failed"],
        },
        flags: {
          validationFailed: true,
          lastValidationError: {
            type: "schema",
            message: "Schema validation failed",
          },
        },
      };
    }

    return {
      output: { validationPassed: true },
      flags: { validationFailed: false },
    };
  } catch (error) {
    return {
      output: { validationPassed: false },
      flags: {
        validationFailed: true,
        lastValidationError: { type: "exception", message: error.message },
      },
    };
  }
}
```

### Processing Stages

Processing stages transform data and pass it forward:

```javascript
async function preProcessing(context) {
  const rawData = context.data.ingestion;
  const { io } = context;

  // Transform the data
  const processedData = transform(rawData);

  // Save intermediate results if needed
  await io.writeFile("processed.json", processedData);

  return {
    output: processedData,
    flags: { preProcessingComplete: true },
  };
}
```

### LLM Integration Stages

Stages that use LLM should access it through `context.llm`:

```javascript
async function inference(context) {
  const { llm } = context;
  const prompt = context.data.promptTemplating;

  const response = await llm.complete({
    prompt,
    maxTokens: 1000,
    temperature: 0.7,
  });

  return {
    output: {
      result: response.text,
      usage: response.usage,
    },
    flags: { inferenceComplete: true },
  };
}
```

## Error Handling

### Synchronous Errors

Throw errors for critical failures that should stop the pipeline:

```javascript
async function parsing(context) {
  const inferenceResult = context.data.inference;

  if (!inferenceResult || !inferenceResult.result) {
    throw new Error("No inference result available for parsing");
  }

  try {
    const parsed = JSON.parse(inferenceResult.result);
    return {
      output: parsed,
      flags: { parsingComplete: true },
    };
  } catch (error) {
    throw new Error(`Failed to parse inference result: ${error.message}`);
  }
}
```

### Graceful Handling

Use flags for recoverable issues:

```javascript
async function validateQuality(context) {
  const content = context.data.validateStructure;

  const qualityScore = assessQuality(content);

  if (qualityScore < 0.7) {
    return {
      output: {
        qualityScore,
        issues: ["Low quality score"],
      },
      flags: {
        qualityFailed: true,
        qualityScore,
      },
    };
  }

  return {
    output: { qualityScore },
    flags: { qualityFailed: false },
  };
}
```

## File Operations

Use the `io` utility for file operations:

```javascript
async function ingestion(context) {
  const { io } = context;
  const seed = context.data.seed;

  // Read input files
  const inputFile = await io.readFile(seed.inputPath);

  // Write intermediate results
  await io.writeFile("ingested.json", inputFile);

  return {
    output: {
      content: inputFile,
      size: inputFile.length,
    },
    flags: { ingestionComplete: true },
  };
}
```

## Best Practices

### 1. Immutability

Never modify the context directly. All changes happen through return values:

```javascript
// ❌ WRONG - Don't modify context
context.flags.validationFailed = true;

// ✅ CORRECT - Return new flag state
return {
  output: {
    /* ... */
  },
  flags: { validationFailed: true },
};
```

### 2. Error Messages

Provide clear, actionable error messages:

```javascript
// ❌ Vague error
throw new Error("Processing failed");

// ✅ Specific error
throw new Error(
  `Failed to process content: missing required field 'title' in ${context.currentStage}`
);
```

### 3. Flag Naming

Use consistent flag naming conventions:

```javascript
// Use descriptive names
flags: {
  validationFailed: boolean,
  critiqueComplete: boolean,
  refinementCount: number,
  lastValidationError: object | string
}

// Include timestamps for debugging
flags: {
  validationTimestamp: Date.now(),
  critiqueTimestamp: Date.now()
}
```

### 4. Output Structure

Structure outputs for clarity and debugging:

```javascript
return {
  output: {
    // Primary result
    result: processedData,

    // Metadata for debugging
    metadata: {
      processedAt: new Date().toISOString(),
      inputSize: inputData.length,
      processingTime: Date.now() - startTime,
    },

    // Additional details
    details: {
      /* ... */
    },
  },
  flags: {
    /* ... */
  },
};
```

## Testing

### Unit Testing

Test handlers with mock contexts:

```javascript
import { describe, it, expect, vi } from "vitest";

describe("validateStructure", () => {
  it("should pass validation for valid data", async () => {
    const mockContext = {
      data: {
        seed: { content: "valid content" },
        parsing: { title: "Test", body: "Content" },
      },
      flags: {},
      meta: {
        io: { writeFile: vi.fn() },
        llm: { complete: vi.fn() },
      },
      currentStage: "validateStructure",
    };

    const result = await validateStructure(mockContext);

    expect(result.output.validationPassed).toBe(true);
    expect(result.flags.validationFailed).toBe(false);
  });
});
```

### Integration Testing

Test handlers within the full pipeline:

```javascript
it("should integrate with other stages", async () => {
  const taskModule = {
    ingestion: mockIngestion,
    validateStructure: actualValidateStructure,
    // ... other stages
  };

  const result = await runPipeline(taskModule, {
    seed: { test: "data" },
    workDir: "/tmp/test",
    jobId: "test-job",
    statusPath: "/tmp/test/status.json",
  });

  expect(result.ok).toBe(true);
  expect(result.context.data.validateStructure).toBeDefined();
});
```

## Debugging

### Console Output

Console output is automatically captured to log files. Use it for debugging:

```javascript
async function validateStructure(context) {
  console.log("Starting validation for stage:", context.currentStage);
  console.log("Input data:", JSON.stringify(context.data, null, 2));

  // ... validation logic

  console.log("Validation result:", validationPassed);

  return {
    output: { validationPassed },
    flags: { validationFailed: !validationPassed },
  };
}
```

### Log Files

Console output is saved to `<jobId>/files/logs/stage-<stageName>.log`. Check these files for debugging stage execution.

### Status File

The `tasks-status.json` file contains the complete pipeline state including all stage outputs and flags. Use it to inspect the final state after execution.

## Common Patterns

### Conditional Processing

```javascript
async function customStage(context) {
  const shouldProcess = context.flags.enableCustomProcessing;

  if (!shouldProcess) {
    return {
      output: { skipped: true },
      flags: { customStageSkipped: true },
    };
  }

  // Process only when flag is set
  const result = await processSomething(context.data.previousStage);

  return {
    output: result,
    flags: { customStageComplete: true },
  };
}
```

### Accumulating Results

```javascript
async function aggregationStage(context) {
  const previousResults = Object.values(context.data).filter(
    (data) => data && typeof data === "object"
  );

  const aggregated = aggregateResults(previousResults);

  return {
    output: { aggregated, count: previousResults.length },
    flags: { aggregationComplete: true },
  };
}
```

### Validation with Multiple Checks

```javascript
async function comprehensiveValidation(context) {
  const content = context.data.parsing;
  const errors = [];

  // Multiple validation checks
  if (!content.title) errors.push("Missing title");
  if (!content.body) errors.push("Missing body");
  if (content.body && content.body.length < 100) errors.push("Body too short");

  const validationPassed = errors.length === 0;

  return {
    output: {
      validationPassed,
      errors,
      score: Math.max(0, 100 - errors.length * 10),
    },
    flags: {
      validationFailed: !validationPassed,
      validationErrors: errors,
      validationScore: Math.max(0, 100 - errors.length * 10),
    },
  };
}
```

## Migration from Old Contract

If you're updating existing handlers, see the [Migration Guide](./migration-guide.md) for detailed instructions on converting from the old context mutation pattern to the new `{ output, flags }` contract.
