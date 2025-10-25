# Task Handler Migration Guide

## Overview

This guide helps developers migrate existing task handlers from the old context mutation pattern to the new `{ output, flags }` contract introduced in the task runner refactor.

## Breaking Changes

### 1. Context Structure Changes

The context object has been restructured:

**Old Structure:**

```javascript
{
  taskName: string,
  workDir: string,
  jobId: string,
  statusPath: string,
  seed: object,
  io: FileIO instance,
  llm: LLM instance,
  validationFailed: boolean,
  lastValidationError: object,
  refined: boolean,
  // ... other top-level properties
  currentStage: string
}
```

**New Structure:**

```javascript
{
  io: FileIO instance,
  llm: LLM instance,
  meta: {
    taskName: string,
    workDir: string,
    jobId: string,
    statusPath: string,
    // ... other meta properties
  },
  data: {
    seed: object,
    validateStructure: object,
    critique: object,
    // ... outputs from previous stages
  },
  flags: {
    validationFailed: boolean,
    critiqueComplete: boolean,
    refined: boolean,
    // ... accumulated flags
  },
  currentStage: string
}
```

### 2. Handler Return Value Changes

**Old Pattern:** Mutate context directly and return any value

```javascript
async function validateStructure(context) {
  // Direct mutation
  context.validationFailed = false;
  context.lastValidationError = null;

  // Return value was optional and could be anything
  return { validationPassed: true };
}
```

**New Pattern:** Return `{ output, flags }` object

```javascript
async function validateStructure(context) {
  // No direct mutation
  return {
    output: { validationPassed: true },
    flags: {
      validationFailed: false,
      lastValidationError: null,
    },
  };
}
```

## Migration Checklist

### Before Migration

- [ ] Identify all task handler functions in your codebase
- [ ] Document current context usage patterns
- [ ] Note any direct context mutations
- [ ] Identify flag dependencies between stages
- [ ] Backup existing handlers

### During Migration

- [ ] Update context property access patterns
- [ ] Replace direct mutations with return values
- [ ] Update utility access (`context.meta.io` → `context.io`)
- [ ] Ensure all handlers return `{ output, flags }`
- [ ] Update error handling patterns

### After Migration

- [ ] Run existing tests to verify functionality
- [ ] Update tests to use new context structure
- [ ] Verify pipeline integration works correctly
- [ ] Check log files for proper console capture
- [ ] Validate status file persistence

## Step-by-Step Migration

### Step 1: Update Context Property Access

**Before:**

```javascript
async function validateStructure(context) {
  const seed = context.seed;
  const { io, llm } = context;
  const taskName = context.taskName;

  // ... handler logic
}
```

**After:**

```javascript
async function validateStructure(context) {
  const seed = context.data.seed;
  const { io, llm } = context;
  const taskName = context.meta.taskName;

  // ... handler logic
}
```

### Step 2: Replace Direct Mutations

**Before:**

```javascript
async function validateStructure(context) {
  const isValid = validateSchema(context.data.parsing);

  // Direct mutations
  context.validationFailed = !isValid;
  if (!isValid) {
    context.lastValidationError = { message: "Schema validation failed" };
  }

  return { validationPassed: isValid };
}
```

**After:**

```javascript
async function validateStructure(context) {
  const isValid = validateSchema(context.data.parsing);

  // Return flags instead of mutating
  const flags = {
    validationFailed: !isValid,
  };

  if (!isValid) {
    flags.lastValidationError = { message: "Schema validation failed" };
  }

  return {
    output: { validationPassed: isValid },
    flags,
  };
}
```

### Step 3: Update Previous Stage Access

**Before:**

```javascript
async function critique(context) {
  const validationResult = context.validateStructure;
  const parsingResult = context.parsing;

  // ... handler logic
}
```

**After:**

```javascript
async function critique(context) {
  const validationResult = context.data.validateStructure;
  const parsingResult = context.data.parsing;

  // ... handler logic
}
```

### Step 4: Update Flag Reading

**Before:**

```javascript
async function refine(context) {
  if (context.validationFailed) {
    // Perform refinement
  }

  if (context.refined) {
    // Skip refinement
  }
}
```

**After:**

```javascript
async function refine(context) {
  if (context.flags.validationFailed) {
    // Perform refinement
  }

  if (context.flags.refined) {
    // Skip refinement
  }
}
```

## Complete Migration Examples

### Example 1: Simple Validation Handler

**Before Migration:**

```javascript
async function validateStructure(context) {
  const content = context.parsing;
  const { io } = context;

  try {
    const isValid = validateSchema(content);

    if (!isValid) {
      context.validationFailed = true;
      context.lastValidationError = {
        type: "schema",
        message: "Invalid structure",
      };
    } else {
      context.validationFailed = false;
      context.lastValidationError = null;
    }

    return { validationPassed: isValid };
  } catch (error) {
    context.validationFailed = true;
    context.lastValidationError = {
      type: "exception",
      message: error.message,
    };
    throw error;
  }
}
```

**After Migration:**

```javascript
async function validateStructure(context) {
  const content = context.data.parsing;
  const { io } = context;

  try {
    const isValid = validateSchema(content);

    const flags = {
      validationFailed: !isValid,
    };

    if (!isValid) {
      flags.lastValidationError = {
        type: "schema",
        message: "Invalid structure",
      };
    }

    return {
      output: { validationPassed: isValid },
      flags,
    };
  } catch (error) {
    // Don't throw for validation errors - use flags instead
    return {
      output: { validationPassed: false },
      flags: {
        validationFailed: true,
        lastValidationError: {
          type: "exception",
          message: error.message,
        },
      },
    };
  }
}
```

### Example 2: LLM Integration Handler

**Before Migration:**

```javascript
async function inference(context) {
  const prompt = context.promptTemplating;
  const { llm } = context;

  const response = await llm.complete({
    prompt,
    maxTokens: 1000,
  });

  context.inferenceResult = response.text;
  context.inferenceUsage = response.usage;

  return response.text;
}
```

**After Migration:**

```javascript
async function inference(context) {
  const prompt = context.data.promptTemplating;
  const { llm } = context;

  const response = await llm.complete({
    prompt,
    maxTokens: 1000,
  });

  return {
    output: {
      result: response.text,
      usage: response.usage,
    },
    flags: {
      inferenceComplete: true,
      inferenceTimestamp: Date.now(),
    },
  };
}
```

### Example 3: File Processing Handler

**Before Migration:**

```javascript
async function ingestion(context) {
  const { io, workDir } = context;
  const seed = context.seed;

  const inputFile = await io.readFile(seed.inputPath);
  const processed = processFile(inputFile);

  await io.writeFile("processed.json", processed);

  context.ingestedData = processed;
  context.fileSize = processed.length;

  return processed;
}
```

**After Migration:**

```javascript
async function ingestion(context) {
  const { io } = context;
  const seed = context.data.seed;

  const inputFile = await io.readFile(seed.inputPath);
  const processed = processFile(inputFile);

  await io.writeFile("processed.json", processed);

  return {
    output: {
      data: processed,
      metadata: {
        fileSize: processed.length,
        processedAt: new Date().toISOString(),
      },
    },
    flags: {
      ingestionComplete: true,
      fileSize: processed.length,
    },
  };
}
```

### Example 4: Complex Multi-Stage Handler

**Before Migration:**

```javascript
async function critique(context) {
  const validationResult = context.validateStructure;
  const { llm } = context;

  if (validationResult.validationPassed) {
    context.critiqueComplete = true;
    context.needsRefinement = false;
    return { critique: "No issues found" };
  }

  const critiquePrompt = buildCritiquePrompt(validationResult);
  const response = await llm.complete(critiquePrompt);

  context.critiqueResult = response.text;
  context.critiqueComplete = true;
  context.needsRefinement = response.text.includes("issues");

  return { critique: response.text };
}
```

**After Migration:**

```javascript
async function critique(context) {
  const validationResult = context.data.validateStructure;
  const { llm } = context;

  if (validationResult.validationPassed) {
    return {
      output: {
        critique: "No issues found",
        score: 100,
      },
      flags: {
        critiqueComplete: true,
        needsRefinement: false,
        critiqueTimestamp: Date.now(),
      },
    };
  }

  const critiquePrompt = buildCritiquePrompt(validationResult);
  const response = await llm.complete(critiquePrompt);

  const needsRefinement = response.text.includes("issues");
  const score = calculateCritiqueScore(response.text);

  return {
    output: {
      critique: response.text,
      score,
      suggestions: extractSuggestions(response.text),
    },
    flags: {
      critiqueComplete: true,
      needsRefinement,
      critiqueTimestamp: Date.now(),
      critiqueScore: score,
    },
  };
}
```

## Common Migration Patterns

### Pattern 1: Simple Flag Updates

**Before:**

```javascript
context.someFlag = true;
return someResult;
```

**After:**

```javascript
return {
  output: someResult,
  flags: { someFlag: true },
};
```

### Pattern 2: Conditional Logic Based on Flags

**Before:**

```javascript
if (context.validationFailed) {
  // Do something
}
```

**After:**

```javascript
if (context.flags.validationFailed) {
  // Do something
}
```

### Pattern 3: Accessing Previous Stage Results

**Before:**

```javascript
const previousResult = context.previousStageName;
```

**After:**

```javascript
const previousResult = context.data.previousStageName;
```

### Pattern 4: Utility Access

**Before:**

```javascript
const { io, llm } = context;
```

**After:**

```javascript
const { io, llm } = context;
```

## Testing Migration

### Update Unit Tests

**Before:**

```javascript
it("should validate structure", async () => {
  const mockContext = {
    parsing: { title: "Test" },
    io: { writeFile: vi.fn() },
  };

  await validateStructure(mockContext);

  expect(mockContext.validationFailed).toBe(false);
});
```

**After:**

```javascript
it("should validate structure", async () => {
  const mockContext = {
    data: {
      parsing: { title: "Test" },
    },
    flags: {},
    meta: {
      io: { writeFile: vi.fn() },
    },
  };

  const result = await validateStructure(mockContext);

  expect(result.output.validationPassed).toBe(true);
  expect(result.flags.validationFailed).toBe(false);
});
```

### Update Integration Tests

**Before:**

```javascript
const result = await runPipeline(taskModule, initialContext);
expect(result.context.validationFailed).toBe(false);
```

**After:**

```javascript
const result = await runPipeline(taskModule, initialContext);
expect(result.context.flags.validationFailed).toBe(false);
```

## Troubleshooting

### Common Issues

1. **"Stage returned null or undefined"**
   - Ensure handler returns `{ output, flags }` object
   - Check for missing return statements

2. **"Stage result missing required property: output/flags"**
   - Verify return object has both `output` and `flags` properties
   - Check for typos in property names

3. **"Stage flags must be a plain object"**
   - Ensure `flags` is a plain object, not array, null, or class instance
   - Remove any non-object flag values

4. **"Flag type conflicts"**
   - Check if different stages are setting same flag with different types
   - Ensure consistent flag types across stages

5. **Context property access errors**
   - Update `context.seed` to `context.data.seed`
   - Update `context.io` to `context.io` (now at top level)
   - Check for other moved properties

### Debugging Tips

1. **Use console logging** - Output is captured to stage-specific log files
2. **Check status file** - `tasks-status.json` shows complete pipeline state
3. **Verify flag flow** - Trace how flags are passed between stages
4. **Test incrementally** - Migrate one stage at a time and test

## Validation

After migration, verify:

1. **All handlers return correct structure**
2. **No direct context mutations**
3. **Proper flag usage patterns**
4. **Correct context property access**
5. **Tests pass with new structure**

Run the full test suite to ensure no regressions:

```bash
npm test
```

## Rollback Plan

If migration causes issues:

1. **Revert to backup** of original handlers
2. **Identify failing stages** through error logs
3. **Fix specific issues** rather than full rollback
4. **Test thoroughly** before redeployment

## Additional Resources

- [Task Development Guide](./task-development-guide.md) - New handler patterns
- [Task Runner Architecture](./task-runner-architecture-review.md) - System overview
- [Stage Reference](./task-runner-stage-reference.md) - Stage-specific details
- Test files in `tests/task-runner.test.js` - Example patterns
