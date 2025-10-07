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

There are two supported ways to run the demo. The recommended, canonical path is the production-mode demo which builds the UI and runs the runner in a production-like configuration. A developer convenience path for local development (Vite dev server) is also available.

Production-mode (canonical)

```bash
# Build UI and run demo in production mode (recommended)
npm run demo:prod

# Or: build UI then run manually
npm run ui:build
NODE_ENV=production node demo/run-demo.js run market-analysis
```

Notes:

- The production demo defaults NODE_ENV to "production" and the server will use the real upload/orchestrator behavior (no bundled demo data shown in the UI).
- Use this path for reliable, repeatable demo behavior (CI, demos, or when you want the orchestrator+UI together).

Dev-mode (developer convenience)

```bash
# Start the UI dev server (Vite) in one terminal
npm run ui:dev
# In another terminal run the demo runner (does NOT auto-start Vite)
node demo/run-demo.js run market-analysis
```

Notes:

- The demo runner will not start Vite automatically. If you want hot-reload, start Vite yourself (see above).
- In dev mode the UI is served by the Vite dev server (default: http://localhost:5173).

### 4. UI Monitoring

Important: the demo runner will serve built UI assets (production build) when present and will run in a production-like mode by default when you use the canonical demo command (`npm run demo:prod`). The demo runner intentionally does not auto-start the Vite dev server; if you want hot-reload, start Vite yourself in a separate terminal.

Build mode (serve the production build)

```bash
# From the project root: build the UI
npm run ui:build

# Run the production-mode demo (recommended)
npm run demo:prod

# Open browser to http://localhost:4123
```

Dev mode (hot-reload with Vite — contributor workflow)

```bash
# Terminal 1 (project root): Start the UI dev server (Vite)
npm run ui:dev
# Vite will serve the app at http://localhost:5173 by default

# Terminal 2 (project root): Run the demo runner (does NOT start Vite)
node demo/run-demo.js run market-analysis

# Open browser to http://localhost:5173
```

Notes:

- Production-mode (`npm run demo:prod`) builds the UI and runs the demo with NODE_ENV=production so uploads and orchestration follow the real code paths.
- The dashboard intentionally does not display bundled/demo jobs at runtime. When the API is unreachable you will see an empty state prompting you to upload a seed.
- For local debugging you can run the dev server separately, but remember the canonical demo path is the production-mode command above.

Troubleshooting

- If the UI does not appear in build mode, confirm that `src/ui/dist/index.html` exists after running `npm run ui:build`. If you used `npm run demo:prod` the build step runs automatically; watch the console for vite build output and any errors.
- If jobs do not appear in the dashboard after submitting a seed:
  - Check `demo/pipeline-data/pending/` for the `{name}-seed.json` file.
  - If present, verify the orchestrator has moved it to `demo/pipeline-data/current/{name}/seed.json` and created `tasks-status.json`.
  - If the file remains in `pending/` and no `current/` folder appears, check orchestrator logs for watcher events and any errors; there may be a path or watcher mismatch.
- If you see a "Duplicate export of 'createSSEEnhancer'" or similar SSE-related errors, they indicate a module export collision. Ensure your local changes include the fix that exports `createSSEEnhancer` from a single canonical module (see `src/ui/sse-enhancer.js`).
- If the dev server is running but the demo UI is unreachable, verify Vite is listening on port 5173 and that no other process is blocking the port.
- For CI or automated runs where you don't want the UI, you may skip building or running the dev server; the demo runner will still execute pipeline jobs in headless mode.

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
