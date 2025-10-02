# Demo Implementation Plan

## Overview

This document outlines the implementation plan for a `/demo` directory that showcases the Prompt Orchestration Pipeline in action. The demo will demonstrate how the library would be integrated into another project, focusing on seed data creation and task definitions while leveraging the core orchestration system.

## Goals

1. **Showcase Real-World Usage**: Demonstrate how developers would integrate the library into their projects
2. **Minimal Boilerplate**: Focus on business logic (tasks and data) rather than infrastructure
3. **Self-Contained**: Demo should run independently with clear setup instructions
4. **Educational**: Serve as a reference implementation for new users
5. **Production-Like**: Use actual LLM providers (with mock fallback option)

## Architecture Alignment

Based on `docs/architecture.md`, the demo will:

- Use the **API layer** (`src/api/index.js`) for programmatic integration
- Define custom **pipeline tasks** following the 11-stage pattern
- Create **seed data** that demonstrates real-world use cases
- Leverage the **orchestrator** for automatic job processing
- Optionally enable the **UI server** for real-time monitoring

## Directory Structure

```
demo/
├── README.md                          # Demo documentation and setup
├── package.json                       # Demo-specific dependencies (if any)
├── .env.example                       # Environment variable template
├── run-demo.js                        # Main demo runner script
├── seeds/                             # Example seed data files
│   ├── market-analysis.json          # Market research analysis
│   ├── content-generation.json       # Content creation workflow
│   └── data-processing.json          # Data extraction and transformation
├── pipeline-config/                   # Pipeline definition
│   ├── pipeline.json                 # Task sequence definition
│   └── tasks/                        # Task implementations
│       ├── index.js                  # Task registry
│       ├── research/                 # Research task
│       │   └── index.js
│       ├── analysis/                 # Analysis task
│       │   └── index.js
│       ├── synthesis/                # Synthesis task
│       │   └── index.js
│       └── formatting/               # Output formatting task
│           └── index.js
└── pipeline-data/                     # Runtime data (gitignored)
    ├── pending/                      # Jobs awaiting processing
    ├── current/                      # Active jobs
    └── complete/                     # Completed jobs
```

## Implementation Steps

### Phase 1: Core Demo Structure

#### 1.1 Create Demo README (`demo/README.md`)

**Purpose**: Provide clear setup and usage instructions

**Content**:

- Overview of what the demo demonstrates
- Prerequisites (Node.js version, API keys)
- Setup instructions
- How to run different scenarios
- Expected output and artifacts
- Troubleshooting guide

**Key Sections**:

```markdown
# Prompt Orchestration Pipeline - Demo

## What This Demo Shows

- How to integrate the pipeline into your project
- Creating custom task definitions
- Defining seed data for different use cases
- Running pipelines programmatically
- Monitoring pipeline execution

## Quick Start

1. Copy `.env.example` to `.env` and add your API keys
2. Run `node run-demo.js market-analysis`
3. View results in `pipeline-data/complete/`

## Available Scenarios

- `market-analysis` - Multi-stage market research
- `content-generation` - Content creation workflow
- `data-processing` - Data extraction and transformation
```

#### 1.2 Create Demo Runner (`demo/run-demo.js`)

**Purpose**: Main entry point that demonstrates API usage

**Key Features**:

- Import and use `createPipelineOrchestrator` from `src/api/index.js`
- Load seed data from `seeds/` directory
- Submit jobs programmatically
- Monitor execution progress
- Display results and artifacts
- Handle errors gracefully

**Implementation Pattern**:

```javascript
import { createPipelineOrchestrator, submitJob } from "../src/api/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function runDemo(scenarioName) {
  // 1. Initialize orchestrator with demo configuration
  const state = await createPipelineOrchestrator({
    rootDir: path.join(process.cwd(), "demo"),
    configDir: "pipeline-config",
    dataDir: "pipeline-data",
    autoStart: true,
    ui: process.env.ENABLE_UI === "true",
    uiPort: 3000,
  });

  // 2. Load seed data
  const seedPath = path.join("demo", "seeds", `${scenarioName}.json`);
  const seed = JSON.parse(await readFile(seedPath, "utf8"));

  // 3. Submit job
  console.log(`Submitting ${scenarioName} job...`);
  const { name } = await submitJob(state, seed);

  // 4. Monitor progress (simplified - real monitoring via UI or polling)
  console.log(`Job ${name} submitted. Monitor at http://localhost:3000`);

  // 5. Wait for completion (demo purposes)
  await waitForCompletion(state, name);

  // 6. Display results
  await displayResults(state, name);

  // 7. Cleanup
  await stop(state);
}
```

#### 1.3 Create Environment Template (`demo/.env.example`)

**Purpose**: Document required environment variables

**Content**:

```bash
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_ORG_ID=your_org_id_here  # Optional

# Anthropic Configuration (optional)
ANTHROPIC_API_KEY=your_anthropic_key_here

# DeepSeek Configuration (optional)
DEEPSEEK_API_KEY=your_deepseek_key_here

# Demo Configuration
ENABLE_UI=true                    # Enable web UI for monitoring
ENABLE_MOCK_PROVIDER=false        # Use mock provider for testing
```

### Phase 2: Seed Data Creation

#### 2.1 Market Analysis Seed (`demo/seeds/market-analysis.json`)

**Purpose**: Demonstrate multi-stage research and analysis workflow

**Structure**:

```json
{
  "name": "market-analysis",
  "type": "market-research",
  "input": {
    "industry": "Renewable Energy Storage",
    "region": "North America",
    "timeframe": "2024-2025",
    "focusAreas": [
      "Market size and growth",
      "Key players and competition",
      "Technology trends",
      "Regulatory landscape"
    ],
    "outputFormat": "executive-summary"
  },
  "config": {
    "model": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 4000
  }
}
```

**Pipeline Flow**:

1. **Research**: Gather information about the industry
2. **Analysis**: Analyze market trends and competitive landscape
3. **Synthesis**: Combine findings into coherent insights
4. **Formatting**: Generate executive summary report

#### 2.2 Content Generation Seed (`demo/seeds/content-generation.json`)

**Purpose**: Demonstrate content creation workflow

**Structure**:

```json
{
  "name": "content-generation",
  "type": "content-creation",
  "input": {
    "topic": "AI-Powered Development Tools",
    "contentType": "blog-post",
    "targetAudience": "software-developers",
    "tone": "professional-yet-accessible",
    "length": "1500-2000 words",
    "keywords": ["AI", "developer tools", "productivity", "automation"]
  },
  "config": {
    "model": "gpt-4o",
    "temperature": 0.8,
    "maxTokens": 3000
  }
}
```

**Pipeline Flow**:

1. **Research**: Gather information about the topic
2. **Analysis**: Identify key themes and structure
3. **Synthesis**: Create content outline and draft
4. **Formatting**: Polish and format final content

#### 2.3 Data Processing Seed (`demo/seeds/data-processing.json`)

**Purpose**: Demonstrate data extraction and transformation

**Structure**:

```json
{
  "name": "data-processing",
  "type": "data-extraction",
  "input": {
    "sourceType": "unstructured-text",
    "dataPoints": [
      "company names",
      "funding amounts",
      "investment dates",
      "investor names",
      "industry sectors"
    ],
    "outputFormat": "structured-json",
    "sampleText": "In Q1 2024, TechCorp raised $50M in Series B funding led by Venture Partners..."
  },
  "config": {
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 2000
  }
}
```

**Pipeline Flow**:

1. **Research**: Understand data structure and requirements
2. **Analysis**: Extract structured data from unstructured text
3. **Synthesis**: Validate and normalize extracted data
4. **Formatting**: Output in requested format (JSON, CSV, etc.)

### Phase 3: Pipeline Configuration

#### 3.1 Pipeline Definition (`demo/pipeline-config/pipeline.json`)

**Purpose**: Define task execution sequence

**Content**:

```json
{
  "name": "demo-pipeline",
  "version": "1.0.0",
  "description": "Demo pipeline showcasing multi-stage LLM workflows",
  "tasks": ["research", "analysis", "synthesis", "formatting"],
  "metadata": {
    "author": "Prompt Orchestration Pipeline",
    "created": "2024-01-01",
    "tags": ["demo", "example", "reference"]
  }
}
```

#### 3.2 Task Registry (`demo/pipeline-config/tasks/index.js`)

**Purpose**: Map task names to implementations

**Content**:

```javascript
export default {
  research: "./research/index.js",
  analysis: "./analysis/index.js",
  synthesis: "./synthesis/index.js",
  formatting: "./formatting/index.js",
};
```

### Phase 4: Task Implementations

Each task follows the 11-stage pipeline pattern defined in `src/core/task-runner.js`.

#### 4.1 Research Task (`demo/pipeline-config/tasks/research/index.js`)

**Purpose**: Gather information based on seed input

**Key Stages**:

```javascript
// ingestion: Load seed data
export async function ingestion(context) {
  const { seed } = context;
  return {
    topic: seed.input.topic || seed.input.industry,
    focusAreas: seed.input.focusAreas || [],
    requirements: seed.input,
  };
}

// promptTemplating: Build research prompt
export async function promptTemplating(context) {
  const { topic, focusAreas } = context.output;

  return {
    system:
      "You are a research assistant specializing in comprehensive information gathering.",
    prompt: `Research the following topic: ${topic}
    
Focus areas:
${focusAreas.map((area) => `- ${area}`).join("\n")}

Provide detailed, factual information with sources where possible.`,
  };
}

// inference: Call LLM
export async function inference(context) {
  const { system, prompt } = context.output;

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model: context.seed.config?.model || "gpt-4o",
    temperature: context.seed.config?.temperature || 0.7,
    max_tokens: context.seed.config?.maxTokens || 2000,
  });

  return {
    researchContent: response.content,
    metadata: {
      model: response.model,
      tokens: response.usage?.total_tokens,
      finishReason: response.finish_reason,
    },
  };
}

// validateStructure: Ensure output has required fields
export async function validateStructure(context) {
  const { researchContent } = context.output;

  if (!researchContent || researchContent.length < 100) {
    context.validationFailed = true;
    context.lastValidationError = "Research content too short or missing";
  }
}

// critique: Generate improvement suggestions (if validation failed)
export async function critique(context) {
  if (!context.validationFailed) return {};

  return {
    critique:
      "Research content needs more depth and detail. Include specific examples and data points.",
  };
}

// refine: Apply improvements (if validation failed)
export async function refine(context) {
  if (!context.validationFailed) return {};

  const { critique } = context.output;

  return {
    refinementApplied: true,
    refinementNote: critique,
  };
}

// integration: Prepare output for next task
export async function integration(context) {
  const { researchContent, metadata } = context.output;

  return {
    research: {
      content: researchContent,
      metadata,
      timestamp: new Date().toISOString(),
    },
  };
}
```

#### 4.2 Analysis Task (`demo/pipeline-config/tasks/analysis/index.js`)

**Purpose**: Analyze research findings and extract insights

**Key Stages**:

```javascript
// ingestion: Load research from previous task
export async function ingestion(context) {
  const { artifacts } = context;
  const research = artifacts?.research?.research;

  if (!research) {
    throw new Error("Research data not found in artifacts");
  }

  return {
    researchContent: research.content,
    analysisType: context.seed.type,
  };
}

// promptTemplating: Build analysis prompt
export async function promptTemplating(context) {
  const { researchContent, analysisType } = context.output;

  return {
    system:
      "You are an expert analyst skilled at extracting insights from research data.",
    prompt: `Analyze the following research and provide key insights:

${researchContent}

Analysis type: ${analysisType}

Provide:
1. Key findings
2. Trends and patterns
3. Opportunities and challenges
4. Recommendations`,
  };
}

// inference: Call LLM for analysis
export async function inference(context) {
  const { system, prompt } = context.output;

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model: context.seed.config?.model || "gpt-4o",
    temperature: 0.5,
    max_tokens: 3000,
  });

  return {
    analysisContent: response.content,
    metadata: {
      model: response.model,
      tokens: response.usage?.total_tokens,
    },
  };
}

// validateStructure: Ensure analysis has key sections
export async function validateStructure(context) {
  const { analysisContent } = context.output;

  const requiredSections = ["findings", "trends", "recommendations"];
  const hasAllSections = requiredSections.every((section) =>
    analysisContent.toLowerCase().includes(section)
  );

  if (!hasAllSections) {
    context.validationFailed = true;
    context.lastValidationError = "Analysis missing required sections";
  }
}

// integration: Prepare output
export async function integration(context) {
  const { analysisContent, metadata } = context.output;

  return {
    analysis: {
      content: analysisContent,
      metadata,
      timestamp: new Date().toISOString(),
    },
  };
}
```

#### 4.3 Synthesis Task (`demo/pipeline-config/tasks/synthesis/index.js`)

**Purpose**: Combine research and analysis into coherent output

**Key Stages**:

```javascript
// ingestion: Load previous task outputs
export async function ingestion(context) {
  const { artifacts } = context;

  return {
    research: artifacts?.research?.research?.content,
    analysis: artifacts?.analysis?.analysis?.content,
    outputFormat: context.seed.input.outputFormat,
  };
}

// promptTemplating: Build synthesis prompt
export async function promptTemplating(context) {
  const { research, analysis, outputFormat } = context.output;

  return {
    system:
      "You are a skilled writer who synthesizes complex information into clear, actionable content.",
    prompt: `Synthesize the following research and analysis into a cohesive ${outputFormat}:

RESEARCH:
${research}

ANALYSIS:
${analysis}

Create a well-structured, comprehensive output that combines these insights.`,
  };
}

// inference: Call LLM for synthesis
export async function inference(context) {
  const { system, prompt } = context.output;

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model: context.seed.config?.model || "gpt-4o",
    temperature: 0.7,
    max_tokens: 4000,
  });

  return {
    synthesizedContent: response.content,
    metadata: {
      model: response.model,
      tokens: response.usage?.total_tokens,
    },
  };
}

// validateQuality: Check synthesis quality
export async function validateQuality(context) {
  const { synthesizedContent } = context.output;

  // Basic quality checks
  const wordCount = synthesizedContent.split(/\s+/).length;

  if (wordCount < 200) {
    context.validationFailed = true;
    context.lastValidationError = "Synthesis lacks depth";
  }
}

// integration: Prepare final output
export async function integration(context) {
  const { synthesizedContent, metadata } = context.output;

  return {
    synthesis: {
      content: synthesizedContent,
      wordCount: synthesizedContent.split(/\s+/).length,
      metadata,
      timestamp: new Date().toISOString(),
    },
  };
}
```

#### 4.4 Formatting Task (`demo/pipeline-config/tasks/formatting/index.js`)

**Purpose**: Format final output according to specifications

**Key Stages**:

```javascript
// ingestion: Load synthesized content
export async function ingestion(context) {
  const { artifacts } = context;
  const synthesis = artifacts?.synthesis?.synthesis;

  return {
    content: synthesis?.content,
    outputFormat: context.seed.input.outputFormat,
    metadata: synthesis?.metadata,
  };
}

// preProcessing: Prepare formatting instructions
export async function preProcessing(context) {
  const { outputFormat } = context.output;

  const formatSpecs = {
    "executive-summary": {
      sections: ["Executive Summary", "Key Findings", "Recommendations"],
      style: "professional, concise",
    },
    "blog-post": {
      sections: ["Introduction", "Main Content", "Conclusion"],
      style: "engaging, accessible",
    },
    "structured-json": {
      format: "JSON",
      style: "machine-readable",
    },
  };

  return {
    ...context.output,
    formatSpec: formatSpecs[outputFormat] || formatSpecs["executive-summary"],
  };
}

// promptTemplating: Build formatting prompt
export async function promptTemplating(context) {
  const { content, formatSpec } = context.output;

  return {
    system:
      "You are a professional editor skilled at formatting content for different audiences and purposes.",
    prompt: `Format the following content according to these specifications:

CONTENT:
${content}

FORMAT SPECIFICATIONS:
${JSON.stringify(formatSpec, null, 2)}

Provide the formatted output with proper structure, headings, and styling.`,
  };
}

// inference: Call LLM for formatting
export async function inference(context) {
  const { system, prompt } = context.output;

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model: context.seed.config?.model || "gpt-4o",
    temperature: 0.3,
    max_tokens: 4000,
  });

  return {
    formattedContent: response.content,
    metadata: {
      model: response.model,
      tokens: response.usage?.total_tokens,
    },
  };
}

// finalValidation: Ensure formatting meets requirements
export async function finalValidation(context) {
  const { formattedContent, formatSpec } = context.output;

  // Check if required sections are present
  if (formatSpec.sections) {
    const missingSections = formatSpec.sections.filter(
      (section) => !formattedContent.includes(section)
    );

    if (missingSections.length > 0) {
      context.validationFailed = true;
      context.lastValidationError = `Missing sections: ${missingSections.join(", ")}`;
    }
  }
}

// integration: Prepare final deliverable
export async function integration(context) {
  const { formattedContent, metadata, formatSpec } = context.output;

  return {
    finalOutput: {
      content: formattedContent,
      format: formatSpec,
      metadata: {
        ...metadata,
        wordCount: formattedContent.split(/\s+/).length,
        characterCount: formattedContent.length,
      },
      timestamp: new Date().toISOString(),
    },
  };
}
```

### Phase 5: Demo Runner Features

#### 5.1 Progress Monitoring

```javascript
async function monitorProgress(state, jobName) {
  const checkInterval = 2000; // 2 seconds

  while (true) {
    const status = await getStatus(state, jobName);

    if (!status) {
      console.log("⏳ Waiting for job to start...");
      await sleep(checkInterval);
      continue;
    }

    // Display current task
    if (status.current) {
      console.log(`🔄 Running: ${status.current}`);
    }

    // Check if complete
    const allDone = Object.values(status.tasks).every(
      (t) => t.state === "done"
    );
    if (allDone) {
      console.log("✅ Pipeline completed!");
      break;
    }

    // Check for failures
    const failed = Object.values(status.tasks).find(
      (t) => t.state === "failed"
    );
    if (failed) {
      console.log("❌ Pipeline failed!");
      break;
    }

    await sleep(checkInterval);
  }
}
```

#### 5.2 Results Display

```javascript
async function displayResults(state, jobName) {
  const completePath = path.join(state.paths.complete, jobName);

  // Read final status
  const status = await getStatus(state, jobName);

  console.log("\n📊 RESULTS SUMMARY");
  console.log("=".repeat(60));
  console.log(`Job: ${jobName}`);
  console.log(`Pipeline ID: ${status.pipelineId}`);
  console.log(`Completed: ${status.finishedAt || "N/A"}`);

  // Display task execution times
  console.log("\n⏱️  Task Execution Times:");
  for (const [taskName, taskInfo] of Object.entries(status.tasks)) {
    const time = taskInfo.executionTime || "N/A";
    const attempts =
      taskInfo.attempts > 1 ? ` (${taskInfo.attempts} attempts)` : "";
    console.log(`  ${taskName}: ${time}ms${attempts}`);
  }

  // Display final output
  const formattingOutput = path.join(
    completePath,
    "tasks",
    "formatting",
    "output.json"
  );
  try {
    const output = JSON.parse(await readFile(formattingOutput, "utf8"));
    console.log("\n📄 FINAL OUTPUT:");
    console.log("=".repeat(60));
    console.log(output.finalOutput.content);
    console.log("\n📈 Metadata:");
    console.log(`  Word Count: ${output.finalOutput.metadata.wordCount}`);
    console.log(`  Model: ${output.finalOutput.metadata.model}`);
    console.log(`  Total Tokens: ${output.finalOutput.metadata.tokens}`);
  } catch (error) {
    console.log("⚠️  Could not read final output");
  }
}
```

#### 5.3 CLI Interface

```javascript
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "run":
      const scenario = args[1] || "market-analysis";
      await runDemo(scenario);
      break;

    case "list":
      console.log("Available scenarios:");
      console.log("  • market-analysis - Multi-stage market research");
      console.log("  • content-generation - Content creation workflow");
      console.log("  • data-processing - Data extraction and transformation");
      break;

    case "clean":
      await cleanupDemoData();
      console.log("✅ Demo data cleaned");
      break;

    case "help":
    default:
      console.log(`
Prompt Orchestration Pipeline - Demo

Usage: node run-demo.js [command] [options]

Commands:
  run [scenario]    Run a demo scenario (default: market-analysis)
  list              List available scenarios
  clean             Clean up demo data
  help              Show this help message

Examples:
  node run-demo.js run market-analysis
  node run-demo.js run content-generation
  node run-demo.js list
      `);
  }
}
```

### Phase 6: Documentation and Testing

#### 6.1 Demo README Sections

1. **Overview**: What the demo demonstrates
2. **Prerequisites**: Required tools and API keys
3. **Setup**: Step-by-step installation
4. **Usage**: How to run different scenarios
5. **Understanding the Output**: Explanation of artifacts
6. **Customization**: How to create custom tasks and seeds
7. **Troubleshooting**: Common issues and solutions
8. **Next Steps**: Links to full documentation

#### 6.2 Testing Checklist

- [ ] Demo runs successfully with real API keys
- [ ] Demo runs with mock provider (for CI/CD)
- [ ] All three scenarios execute correctly
- [ ] Error handling works properly
- [ ] UI integration works (if enabled)
- [ ] Results are displayed correctly
- [ ] Cleanup works properly
- [ ] Documentation is clear and accurate

## Integration Points

### With Existing System

1. **API Layer**: Uses `src/api/index.js` for all orchestration
2. **Task Runner**: Tasks follow 11-stage pattern from `src/core/task-runner.js`
3. **LLM Layer**: Uses `src/llm/index.js` for provider abstraction
4. **Environment**: Leverages `src/core/environment.js` for configuration
5. **Validation**: Uses `src/core/validation.js` for seed validation

### File System Layout

```
project-root/
├── src/                    # Core library code
├── demo/                   # Demo implementation
│   ├── pipeline-config/   # Demo-specific tasks
│   ├── pipeline-data/     # Demo runtime data (gitignored)
│   └── seeds/             # Example seed files
└── tests/                 # Library tests
```

## Success Criteria

1. **Functional**: Demo runs end-to-end without errors
2. **Educational**: New users can understand how to use the library
3. **Realistic**: Demonstrates real-world use cases
4. **Maintainable**: Easy to update as library evolves
5. **Documented**: Clear instructions and explanations
6. **Testable**: Can run in CI/CD with mock provider

## Future Enhancements

1. **Interactive Mode**: CLI prompts for custom scenarios
2. **More Scenarios**: Additional use cases (summarization, translation, etc.)
3. **Mock Provider**: Built-in mock for testing without API keys
4. **Performance Metrics**: Detailed timing and cost analysis
5. **Comparison Mode**: Run same scenario with different models
6. **Export Options**: Save results in different formats (PDF, HTML, etc.)

## Timeline Estimate

- **Phase 1** (Core Structure): 2-3 hours
- **Phase 2** (Seed Data): 1-2 hours
- **Phase 3** (Pipeline Config): 1 hour
- **Phase 4** (Task Implementations): 4-6 hours
- **Phase 5** (Demo Runner): 2-3 hours
- **Phase 6** (Documentation): 2-3 hours

**Total**: 12-18 hours for complete implementation

## Notes

- Focus on clarity over complexity
- Use real-world scenarios that developers can relate to
- Provide both simple and advanced examples
- Make it easy to extend with custom tasks
- Ensure demo works offline with mock provider option
- Keep dependencies minimal (use library's existing deps)
