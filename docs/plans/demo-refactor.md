# Demo Directory Refactor Plan

## Overview

This document outlines necessary updates to align the `/demo` directory with the current architecture as documented in `docs/architecture.md`. The demo currently uses outdated patterns and bypasses the canonical LLM abstraction layer.

## Current State Analysis

### Directory Structure

```
demo/
├── config.json                          # ❌ Unused/redundant
├── demo-config.js                       # ✅ Demo seed data
├── integrated-demo.js                   # ⚠️  Needs updates
├── mock-chatgpt.js                      # ❌ Bypasses LLM layer
├── pipeline.json                        # ❌ Duplicate/outdated
├── setup-demo.js                        # ⚠️  Needs updates
├── pipeline-config/
│   ├── pipeline.json                    # ⚠️  Needs alignment
│   └── tasks/                           # ❌ Missing task registry
├── pipeline-tasks/
│   ├── index.js                         # ⚠️  Task registry format
│   ├── data-extraction/index.js         # ❌ Direct mock calls
│   ├── analysis/index.js                # ❌ Direct mock calls
│   └── report-generation/index.js       # ❌ Direct mock calls
├── pipeline-data/                       # ✅ Correct structure
├── pipeline-current/                    # ✅ Correct structure
├── pipeline-complete/                   # ✅ Correct structure
└── task-runner/                         # ❌ Unclear purpose
```

## Critical Issues

### 1. LLM Integration Bypass ❌ HIGH PRIORITY

**Problem**: Tasks directly import and call `mock-chatgpt.js`, bypassing the canonical `src/llm/index.js` abstraction layer.

**Current Pattern** (in `demo/pipeline-tasks/data-extraction/index.js`):

```javascript
import { callChatGPT, MockChatGPT } from "../../mock-chatgpt.js";

async inference(context) {
  const model = MockChatGPT.selectBestModel("extraction", "medium");
  const response = await callChatGPT(prompt, model);
  // ...
}
```

**Architecture Requirement**: Tasks should use `context.llm` interface provided by task-runner.

**Expected Pattern**:

```javascript
async inference(context) {
  const response = await context.llm.chat({
    messages: [
      { role: "system", content: "You are a data extraction assistant." },
      { role: "user", content: prompt }
    ],
    model: "gpt-3.5-turbo",
    temperature: 0.7
  });

  return {
    rawOutput: response.content,
    modelMetadata: {
      model: response.model,
      tokens: response.usage.totalTokens,
      cost: response.cost
    }
  };
}
```

**Impact**:

- Breaks event-based metrics collection
- Bypasses retry logic
- Inconsistent with production patterns
- No token/cost tracking
- Cannot leverage provider abstraction

### 2. Missing Refinement Stages ✅ COMPLETED (PR #22)

**Problem**: Demo tasks don't implement `critique` and `refine` stages required by the 11-stage pipeline.

**Status**: ✅ Resolved in commit 6b2889e (PR #22)

**Architecture Requirement**: Tasks must implement all relevant stages from the 11-stage pipeline:

```javascript
ORDER = [
  "ingestion",
  "preProcessing",
  "promptTemplating",
  "inference",
  "parsing",
  "validateStructure",
  "validateQuality",
  "critique", // ❌ MISSING
  "refine", // ❌ MISSING
  "finalValidation",
  "integration",
];
```

**Current State**: Demo tasks only implement 8 stages, missing the automatic refinement cycle.

**Required Implementation**:

```javascript
async critique(context) {
  if (!context.validationFailed) return { critique: null };

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: "Analyze the validation failure and suggest improvements." },
      { role: "user", content: `Previous output: ${context.parsedOutput}\nError: ${context.lastValidationError}` }
    ]
  });

  return { critique: response.content };
}

async refine(context) {
  if (!context.critique) return { refined: false };

  // Apply critique to improve the prompt or processing
  const improvedPrompt = `${context.prompt}\n\nImprovement guidance: ${context.critique}`;

  return {
    prompt: improvedPrompt,
    refined: true
  };
}
```

### 3. Incorrect Pipeline Runner Path ❌ HIGH PRIORITY

**Problem**: `integrated-demo.js` references wrong path for pipeline-runner.

**Current Code** (line 82):

```javascript
const child = spawn(
  process.execPath,
  ["./../lib/pipeline-runner.js", pipelineName] // ❌ Wrong path
  // ...
);
```

**Correct Path**: Should be `../src/core/pipeline-runner.js`

**Impact**: Demo cannot spawn pipeline-runner processes correctly.

### 4. Duplicate Configuration Files ⚠️ MEDIUM PRIORITY

**Problem**: Multiple pipeline configuration files with unclear precedence.

**Files**:

- `demo/config.json` - Appears unused
- `demo/pipeline.json` - Duplicate of pipeline-config/pipeline.json
- `demo/pipeline-config/pipeline.json` - Active configuration

**Recommendation**:

- Remove `demo/config.json` and `demo/pipeline.json`
- Keep only `demo/pipeline-config/pipeline.json`
- Document configuration schema

### 5. Task Registry Format Mismatch ⚠️ MEDIUM PRIORITY

**Problem**: Task registry doesn't follow documented format.

**Current** (`demo/pipeline-tasks/index.js`):

```javascript
export default {
  "data-extraction": "./data-extraction/index.js",
  analysis: "./analysis/index.js",
  "report-generation": "./report-generation/index.js",
};
```

**Architecture Requirement**: Should be in `pipeline-config/tasks/index.js` per architecture docs.

**Recommendation**: Move task registry to proper location and update pipeline-runner to load from correct path.

### 6. Missing Environment Configuration ⚠️ MEDIUM PRIORITY

**Problem**: Demo doesn't demonstrate environment configuration loading.

**Architecture Requirement**: Should use `src/core/environment.js` for provider configuration.

**Current State**: Mock implementation doesn't show how real providers would be configured.

**Recommendation**: Add demo `.env.example` showing:

```bash
# Demo uses mock provider, but structure matches production
OPENAI_API_KEY=demo-key-not-real
OPENAI_MODEL=gpt-4-turbo
ANTHROPIC_API_KEY=demo-key-not-real
```

### 7. Incomplete Pipeline Definition ✅ COMPLETED (PR #25)

**Problem**: Pipeline definition missing required metadata.

**Status**: ✅ Resolved in PR #25 (refactor/demo-config-cleanup)

**Architecture Requirement**: Should include name and version per docs.

**Current** (`demo/pipeline-config/pipeline.json`):

```json
{
  "name": "demo-market-analysis",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "data-extraction",
      "name": "data-extraction",
      "config": { "model": "gpt-5-nano", "temperature": 0.5, "maxTokens": 2000 }
    },
    {
      "id": "analysis",
      "name": "analysis",
      "config": { "model": "gpt-5-nano", "temperature": 0.6, "maxTokens": 2500 }
    },
    {
      "id": "report-generation",
      "name": "report-generation",
      "config": { "model": "gpt-5-nano", "temperature": 0.7, "maxTokens": 3000 }
    }
  ],
  "config": {
    "retryPolicy": {
      "maxRetries": 3,
      "retryableStages": ["validateStructure", "validateQuality"]
    },
    "models": {
      "fast": "gpt-3.5-turbo",
      "accurate": "gpt-4",
      "creative": "claude-3-opus"
    }
  }
}
```

**Note**: The non-existent "summarization" task was also removed from the tasks list.

### 8. Mock Provider Implementation 🔧 ENHANCEMENT

**Problem**: Mock implementation doesn't follow provider interface contract.

**Current**: `mock-chatgpt.js` has custom interface incompatible with real providers.

**Recommendation**: Create proper mock provider following `src/providers/base.js` patterns:

```javascript
// demo/providers/mock-provider.js
export class MockProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async chat(options) {
    const { messages, model = "gpt-3.5-turbo", temperature = 0.7 } = options;

    // Simulate latency
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200)
    );

    // Generate mock response based on message content
    const content = this.generateMockResponse(messages);

    return {
      content,
      model,
      usage: {
        promptTokens: this.estimateTokens(messages),
        completionTokens: this.estimateTokens([{ content }]),
        totalTokens:
          this.estimateTokens(messages) + this.estimateTokens([{ content }]),
      },
      cost: this.calculateCost(model, usage),
      finishReason: "stop",
    };
  }

  generateMockResponse(messages) {
    // Intelligent mock response generation
    // ...
  }

  estimateTokens(messages) {
    return messages.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0
    );
  }

  calculateCost(model, usage) {
    const rates = {
      "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
      "gpt-4": { input: 0.03, output: 0.06 },
    };
    const rate = rates[model] || rates["gpt-3.5-turbo"];
    return (
      (usage.promptTokens * rate.input + usage.completionTokens * rate.output) /
      1000
    );
  }
}
```

Then register in LLM layer:

```javascript
// In demo setup
import { createLLM } from "../src/llm/index.js";
import { MockProvider } from "./providers/mock-provider.js";

const llm = createLLM({
  provider: "mock",
  providerInstance: new MockProvider(),
});
```

## Refactor Plan

### Phase 1: Critical Fixes (High Priority)

#### 1.1 Update Task Implementations

**Files to Update**:

- `demo/pipeline-tasks/data-extraction/index.js`
- `demo/pipeline-tasks/analysis/index.js`
- `demo/pipeline-tasks/report-generation/index.js`

**Changes**:

1. Remove direct `mock-chatgpt.js` imports
2. Use `context.llm.chat()` interface
3. Add `critique` and `refine` stages
4. Add `finalValidation` stage
5. Update to use proper context flow

**Example Refactor** (data-extraction/index.js):

```javascript
// Remove: import { callChatGPT, MockChatGPT } from "../../mock-chatgpt.js";

const dataExtraction = {
  async ingestion(context) {
    console.log("📥 [Data Extraction] Starting ingestion...");
    const { seed } = context;

    return {
      rawData: seed.input,
      extractionTargets: seed.requirements?.sections || [
        "companies",
        "market_size",
        "trends",
      ],
    };
  },

  async preProcessing(context) {
    console.log("⚙️ [Data Extraction] Pre-processing...");
    const { rawData, extractionTargets } = context;

    return {
      processedInput: {
        industry: rawData.industry,
        region: rawData.region,
        timeframe: rawData.timeframe,
        targets: extractionTargets,
      },
    };
  },

  async promptTemplating(context) {
    console.log("📝 [Data Extraction] Creating prompt...");
    const { processedInput, refined, critique } = context;

    let prompt = `Extract key data points about the ${processedInput.industry} industry in ${processedInput.region} for ${processedInput.timeframe}.

Focus on extracting:
${processedInput.targets.map((t) => `- ${t}`).join("\n")}

Provide specific numbers, company names, and market metrics where possible.
Format the response as structured data with clear categories.`;

    // Apply refinement if available
    if (refined && critique) {
      prompt += `\n\nPrevious attempt had issues. Improvement guidance:\n${critique}`;
    }

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Data Extraction] Calling LLM...");
    const { prompt } = context;

    // Use context.llm interface instead of direct mock calls
    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a data extraction assistant. Extract structured market data from the given requirements.",
        },
        { role: "user", content: prompt },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.7,
    });

    return {
      rawOutput: response.content,
      modelMetadata: {
        model: response.model,
        tokens: response.usage.totalTokens,
        cost: response.cost,
        confidence: 0.85, // Mock confidence for demo
      },
    };
  },

  async parsing(context) {
    console.log("🔧 [Data Extraction] Parsing output...");
    const { rawOutput } = context;

    return {
      parsedOutput: {
        extractedData: rawOutput,
        extractionType: "market_data",
        timestamp: new Date().toISOString(),
      },
    };
  },

  async validateStructure(context) {
    console.log("✅ [Data Extraction] Validating structure...");
    const { parsedOutput } = context;

    if (!parsedOutput.extractedData || parsedOutput.extractedData.length < 50) {
      context.validationFailed = true;
      context.lastValidationError = "Extracted data is too short or missing";
      throw new Error(context.lastValidationError);
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Data Extraction] Validating quality...");
    const { modelMetadata } = context;

    if (modelMetadata.confidence < 0.7) {
      context.validationFailed = true;
      context.lastValidationError = `Model confidence too low: ${modelMetadata.confidence}`;
      throw new Error(context.lastValidationError);
    }

    return { qualityValid: true };
  },

  async critique(context) {
    console.log("🔍 [Data Extraction] Generating critique...");

    // Only run if validation failed
    if (!context.validationFailed) {
      return { critique: null };
    }

    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a quality assurance expert. Analyze why the data extraction failed and suggest specific improvements.",
        },
        {
          role: "user",
          content: `The data extraction failed with error: ${context.lastValidationError}\n\nOriginal output: ${context.parsedOutput?.extractedData || "N/A"}\n\nProvide specific guidance on how to improve the extraction.`,
        },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3,
    });

    return { critique: response.content };
  },

  async refine(context) {
    console.log("✨ [Data Extraction] Applying refinements...");

    // Only run if we have critique
    if (!context.critique) {
      return { refined: false };
    }

    // Mark that refinement has been applied
    // The promptTemplating stage will use this to enhance the prompt
    return { refined: true };
  },

  async finalValidation(context) {
    console.log("🎯 [Data Extraction] Final validation...");
    const { parsedOutput, modelMetadata } = context;

    // Comprehensive final check
    const checks = {
      hasData:
        parsedOutput.extractedData && parsedOutput.extractedData.length >= 50,
      hasMetadata: !!modelMetadata,
      hasTimestamp: !!parsedOutput.timestamp,
      confidenceOk: modelMetadata.confidence >= 0.7,
    };

    const allPassed = Object.values(checks).every((v) => v);

    if (!allPassed) {
      throw new Error(`Final validation failed: ${JSON.stringify(checks)}`);
    }

    return { finalValidationPassed: true };
  },

  async integration(context) {
    console.log("📦 [Data Extraction] Finalizing...");
    const { parsedOutput, modelMetadata } = context;

    return {
      output: {
        ...parsedOutput,
        metadata: modelMetadata,
        stage: "data_extraction_complete",
      },
    };
  },
};

export default dataExtraction;
```

#### 1.2 Fix Pipeline Runner Path

**File**: `demo/integrated-demo.js`

**Change** (line 82):

```javascript
// Before:
const child = spawn(
  process.execPath,
  ["./../lib/pipeline-runner.js", pipelineName]
  // ...
);

// After:
const child = spawn(
  process.execPath,
  ["../src/core/pipeline-runner.js", pipelineName],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PO_ROOT: ROOT,
      PO_DATA_DIR: path.join(ROOT, "pipeline-data"),
      PO_CURRENT_DIR: CURRENT_DIR,
      PO_COMPLETE_DIR: COMPLETE_DIR,
      PO_CONFIG_DIR: path.join(ROOT, "pipeline-config"),
      PO_PIPELINE_PATH: path.join(ROOT, "pipeline-config/pipeline.json"),
      PO_TASK_REGISTRY: path.join(ROOT, "pipeline-tasks/index.js"),
    },
    cwd: ROOT,
  }
);
```

#### 1.3 Create Mock Provider

**New File**: `demo/providers/mock-provider.js`

See detailed implementation in section 8 above.

**New File**: `demo/providers/index.js`

```javascript
import { MockProvider } from "./mock-provider.js";

export function createMockLLM() {
  return new MockProvider({
    name: "mock",
    simulateLatency: true,
    failureRate: 0.05, // 5% random failures for testing
  });
}
```

### Phase 2: Configuration Cleanup (Medium Priority)

#### 2.1 Remove Duplicate Files

**Files to Remove**:

- `demo/config.json`
- `demo/pipeline.json`

**Command**:

```bash
cd demo
rm config.json pipeline.json
```

#### 2.2 Update Pipeline Configuration

**File**: `demo/pipeline-config/pipeline.json`

```json
{
  "name": "demo-market-analysis",
  "version": "1.0.0",
  "tasks": ["data-extraction", "analysis", "report-generation"]
}
```

**Note**: Remove "summarization" from tasks list as it doesn't exist.

#### 2.3 Move Task Registry

**Current Location**: `demo/pipeline-tasks/index.js`
**New Location**: `demo/pipeline-config/tasks/index.js`

**Content**:

```javascript
export default {
  "data-extraction": "../../pipeline-tasks/data-extraction/index.js",
  analysis: "../../pipeline-tasks/analysis/index.js",
  "report-generation": "../../pipeline-tasks/report-generation/index.js",
};
```

#### 2.4 Add Environment Example

**New File**: `demo/.env.example`

```bash
# Demo Environment Configuration
# This demo uses mock providers, but structure matches production

# Mock Provider (default for demo)
DEMO_MODE=true

# If you want to test with real providers, set DEMO_MODE=false and configure:
# OPENAI_API_KEY=your-key-here
# OPENAI_MODEL=gpt-4-turbo
# ANTHROPIC_API_KEY=your-key-here
# DEEPSEEK_API_KEY=your-key-here
```

### Phase 3: Documentation Updates (Low Priority)

#### 3.1 Update Demo README

**File**: `demo/README.md`

Add sections:

- **Architecture Alignment**: Explain how demo follows production patterns
- **Mock Provider**: Document mock provider implementation
- **11-Stage Pipeline**: Show how demo implements all stages
- **LLM Integration**: Explain context.llm usage

#### 3.2 Add Task Documentation

**New File**: `demo/pipeline-tasks/README.md`

```markdown
# Demo Pipeline Tasks

This directory contains example task implementations that demonstrate the 11-stage pipeline architecture.

## Task Structure

Each task implements the following stages:

1. **ingestion** - Load and prepare input data
2. **preProcessing** - Clean and transform data
3. **promptTemplating** - Build LLM prompts
4. **inference** - Call LLM via context.llm
5. **parsing** - Parse LLM response
6. **validateStructure** - Validate output structure
7. **validateQuality** - Validate output quality
8. **critique** - Generate improvement suggestions (on failure)
9. **refine** - Apply refinements (on failure)
10. **finalValidation** - Final quality check
11. **integration** - Integrate results

## LLM Integration

Tasks use the `context.llm` interface provided by task-runner:

\`\`\`javascript
async inference(context) {
const response = await context.llm.chat({
messages: [
{ role: "system", content: "System prompt" },
{ role: "user", content: context.prompt }
],
model: "gpt-3.5-turbo",
temperature: 0.7
});

return { rawOutput: response.content };
}
\`\`\`

## Refinement Cycle

When validation fails, the pipeline automatically:

1. Runs `critique` to analyze the failure
2. Runs `refine` to apply improvements
3. Re-runs from `promptTemplating` with refinements
4. Maximum 2 refinement attempts

## Available Tasks

- **data-extraction** - Extract structured data from requirements
- **analysis** - Analyze extracted data and generate insights
- **report-generation** - Generate formatted reports from analysis
```

#### 3.3 Add Setup Documentation

**New File**: `demo/SETUP.md`

```markdown
# Demo Setup Guide

## Quick Start

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Run setup script:
   \`\`\`bash
   node setup-demo.js
   \`\`\`

3. Run demo:
   \`\`\`bash
   npm run demo
   \`\`\`

## Architecture

The demo uses the complete production architecture:

- **Orchestrator**: Watches for seed files and spawns pipeline-runner processes
- **Pipeline Runner**: Manages task execution and state
- **Task Runner**: Executes 11-stage pipeline for each task
- **LLM Layer**: Provides unified interface to mock provider
- **Mock Provider**: Simulates real LLM provider behavior

## Directory Structure

\`\`\`
demo/
├── pipeline-config/ # Pipeline configuration
│ ├── pipeline.json # Pipeline definition
│ └── tasks/
│ └── index.js # Task registry
├── pipeline-tasks/ # Task implementations
│ ├── data-extraction/
│ ├── analysis/
│ └── report-generation/
├── pipeline-data/ # Runtime data
│ ├── pending/ # Seed files
│ ├── current/ # Active pipelines
│ └── complete/ # Completed pipelines
├── providers/ # Mock provider implementation
│ ├── mock-provider.js
│ └── index.js
└── integrated-demo.js # Demo runner
\`\`\`

## Testing with Real Providers

To test with real LLM providers:

1. Copy `.env.example` to `.env`
2. Set `DEMO_MODE=false`
3. Add your API keys
4. Run demo normally

The demo will automatically use real providers instead of mocks.
```

## Implementation Checklist

### Phase 1: Critical Fixes

- [ ] Update `data-extraction/index.js` to use `context.llm` and add missing stages
- [ ] Update `analysis/index.js` to use `context.llm` and add missing stages
- [ ] Update `report-generation/index.js` to use `context.llm` and add missing stages
- [ ] Fix pipeline-runner path in `integrated-demo.js`
- [ ] Add environment variable configuration to spawn call
- [ ] Create `demo/providers/mock-provider.js`
- [ ] Create `demo/providers/index.js`
- [ ] Update demo to initialize mock provider properly

### Phase 2: Configuration Cleanup

- [ ] Remove `demo/config.json`
- [ ] Remove `demo/pipeline.json`
- [ ] Update `demo/pipeline-config/pipeline.json` with name and version
- [ ] Remove "summarization" from tasks list
- [ ] Move task registry to `demo/pipeline-config/tasks/index.js`
- [ ] Update paths in task registry
- [ ] Create `demo/.env.example`

### Phase 3: Documentation

- [ ] Update `demo/README.md` with architecture alignment section
- [ ] Create `demo/pipeline-tasks/README.md`
- [ ] Create `demo/SETUP.md`
- [ ] Add inline code comments explaining patterns
- [ ] Update package.json scripts if needed

## Testing Plan

After refactoring, verify:

1. **Basic Execution**:

   ```bash
   npm run demo
   ```

   Should complete successfully with all stages executing.

2. **Refinement Cycle**:
   Temporarily lower confidence threshold to trigger refinement:

   ```javascript
   if (modelMetadata.confidence < 0.95) { // Force failure
   ```

   Verify critique and refine stages execute.

3. **Metrics Collection**:
   Check that LLM metrics are collected and displayed:
   - Token counts
   - Cost calculations
   - Model information

4. **Artifact Flow**:
   Verify artifacts pass correctly between tasks:

   ```bash
   cat demo/pipeline-complete/*/tasks/*/output.json
   ```

5. **Error Handling**:
   Test with invalid seed data to verify error handling.

## Migration Notes

### Breaking Changes

1. **Task Interface**: Tasks must now use `context.llm` instead of direct mock calls
2. **Stage Requirements**: All tasks must implement critique, refine, and finalValidation stages
3. **Configuration**: Task registry moved to pipeline-config/tasks/

### Backward Compatibility

The refactored demo maintains compatibility with:

- Existing seed file format
- Directory structure (pipeline-data, pipeline-current, pipeline-complete)
- Output artifact format

### Rollback Plan

If issues arise:

1. Revert to previous commit
2. Keep refactored mock provider for future use
3. Document specific issues encountered

## Benefits of Refactoring

1. **Architecture Alignment**: Demo accurately represents production patterns
2. **Better Testing**: Can test real provider integration
3. **Metrics Collection**: Proper token and cost tracking
4. **Refinement Demo**: Shows automatic quality improvement
5. **Maintainability**: Easier to keep demo in sync with core changes
6. **Documentation**: Demo serves as reference implementation

## Future Enhancements

After completing this refactor, consider:

1. **Multiple Providers**: Demo switching between OpenAI, Anthropic, DeepSeek
2. **UI Integration**: Add demo UI server to show real-time monitoring
3. **Complex Pipelines**: Add branching/conditional task execution
4. **Error Scenarios**: Add demos of various failure modes and recovery
5. **Performance Testing**: Add load testing scenarios
6. **Streaming**: Demo streaming responses for long-running tasks

## Conclusion

This refactor aligns the demo with the current architecture, making it a valuable reference implementation and testing tool. The changes are primarily additive, maintaining backward compatibility while adding missing functionality.

Priority should be given to Phase 1 (Critical Fixes) as these address functional issues that prevent the demo from working correctly with the current architecture.
