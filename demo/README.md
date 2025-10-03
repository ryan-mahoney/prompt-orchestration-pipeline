# Prompt Orchestration Pipeline - Demo

This demo showcases how to integrate the Prompt Orchestration Pipeline into your project. It demonstrates multi-stage LLM workflows with research, analysis, synthesis, and formatting tasks.

## What This Demo Shows

- How to integrate the pipeline into your project
- Creating custom task definitions following the 11-stage pattern
- Defining seed data for different use cases
- Running pipelines programmatically via the API
- Monitoring pipeline execution (optional UI)

## Quick Start

### 1. Prerequisites

- Node.js v18+ installed
- OpenAI API key (or other supported provider)

### 2. Setup

```bash
# Copy environment template
cp .env.example .env

# Add your API key to .env
# OPENAI_API_KEY=your_key_here
```

### 3. Run a Demo

```bash
# Run market analysis demo
node run-demo.js run market-analysis

# Run content generation demo
node run-demo.js run content-generation

# Run data processing demo
node run-demo.js run data-processing

# List all available scenarios
node run-demo.js list
```

### 4. Enable UI Monitoring (Optional)

```bash
# Set environment variable
export ENABLE_UI=true

# Run demo
node run-demo.js run market-analysis

# Open browser to http://localhost:3000
```

## Available Scenarios

### Market Analysis

**File:** `seeds/market-analysis.json`

Demonstrates a multi-stage market research workflow:

1. **Research** - Gather information about renewable energy storage
2. **Analysis** - Extract key findings and trends
3. **Synthesis** - Combine insights into coherent narrative
4. **Formatting** - Format as executive summary

### Content Generation

**File:** `seeds/content-generation.json`

Demonstrates content creation workflow:

1. **Research** - Gather information about AI development tools
2. **Analysis** - Identify key themes and structure
3. **Synthesis** - Create content outline and draft
4. **Formatting** - Polish and format as blog post

### Data Processing

**File:** `seeds/data-processing.json`

Demonstrates data extraction workflow:

1. **Research** - Understand data structure requirements
2. **Analysis** - Extract structured data from unstructured text
3. **Synthesis** - Validate and normalize extracted data
4. **Formatting** - Output in requested format (JSON, CSV, etc.)

## Project Structure

```
demo/
├── README.md                          # This file
├── .env.example                       # Environment variable template
├── run-demo.js                        # Demo runner script
├── seeds/                             # Example seed data
│   ├── market-analysis.json
│   ├── content-generation.json
│   └── data-processing.json
├── pipeline-config/                   # Pipeline configuration
│   ├── pipeline.json                  # Task sequence definition
│   └── tasks/                         # Task implementations
│       ├── index.js                   # Task registry
│       ├── research/index.js          # Research task
│       ├── analysis/index.js          # Analysis task
│       ├── synthesis/index.js         # Synthesis task
│       └── formatting/index.js        # Formatting task
└── pipeline-data/                     # Runtime data (auto-created)
    ├── pending/                       # Jobs awaiting processing
    ├── current/                       # Active jobs
    └── complete/                      # Completed jobs
```

## Creating Custom Tasks

Tasks follow the 11-stage pipeline pattern. Here's a minimal example:

```javascript
// my-task/index.js

// Stage 1: Load and prepare input data
export async function ingestion(context) {
  const { seed } = context;
  return {
    data: seed.input.data,
  };
}

// Stage 2: Build prompt for LLM
export async function promptTemplating(context) {
  const { data } = context.output;
  return {
    system: "You are a helpful assistant.",
    prompt: `Process this data: ${data}`,
  };
}

// Stage 3: Call LLM
export async function inference(context) {
  const { system, prompt } = context.output;

  const response = await context.llm.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    model: "gpt-4o",
    temperature: 0.7,
  });

  return {
    result: response.content,
  };
}

// Stage 4: Validate output
export async function validateStructure(context) {
  const { result } = context.output;

  if (!result || result.length < 10) {
    context.validationFailed = true;
    context.lastValidationError = "Result too short";
  }
}

// Stage 5: Prepare final output
export async function integration(context) {
  const { result } = context.output;

  return {
    myTask: {
      result,
      timestamp: new Date().toISOString(),
    },
  };
}
```

## Creating Custom Seeds

Seeds define the input data and configuration for a pipeline run:

```json
{
  "name": "my-custom-job",
  "type": "custom-type",
  "input": {
    "field1": "value1",
    "field2": "value2"
  },
  "config": {
    "model": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

## Viewing Results

After a pipeline completes, results are stored in:

```
demo/pipeline-data/complete/{job-name}/
├── seed.json                          # Original seed data
├── tasks-status.json                  # Execution status
└── tasks/                             # Task outputs
    ├── research/output.json
    ├── analysis/output.json
    ├── synthesis/output.json
    └── formatting/output.json
```

## Troubleshooting

### "Provider not available" Error

Make sure you've set your API key in `.env`:

```bash
OPENAI_API_KEY=your_key_here
```

### Pipeline Fails Immediately

Check the task-status.json file for error details:

```bash
cat demo/pipeline-data/current/*/tasks-status.json
```

### Tasks Not Found

Ensure task paths in `pipeline-config/tasks/index.js` are correct and point to valid task modules.

## Next Steps

1. **Customize Tasks** - Modify existing tasks or create new ones
2. **Add Scenarios** - Create new seed files for different use cases
3. **Integrate** - Use the API layer to integrate into your own projects
4. **Extend** - Add validation, error handling, and custom logic

## Learn More

- [Main Documentation](../README.md)
- [Architecture Guide](../docs/architecture.md)
- [API Reference](../src/api/README.md)
- [Task Runner Details](../src/core/task-runner.js)
