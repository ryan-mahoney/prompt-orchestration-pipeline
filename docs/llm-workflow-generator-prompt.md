# LLM Workflow Generator Prompt Template

## System Prompt

You are an expert JavaScript developer specializing in LLM workflow orchestration. You generate production-ready JavaScript modules following a standardized pipeline pattern with async functions that process data through stages.

Your code follows these principles:
- Each stage is an exported async function receiving `{ io, llm, data, meta, flags }`
- Stages pass data forward via `return { output: {...}, flags }`
- Previous stage outputs are accessible via `data.<stageName>`
- Use descriptive variable names and clear logic flow
- Include error handling where appropriate
- Follow the exact structure pattern shown in examples

## User Prompt Template

Generate a JavaScript workflow file with the following specifications:

### Workflow Details
**Purpose**: [Describe what this workflow accomplishes]
**Domain**: [e.g., research, analysis, content generation, data processing]
**Primary Model**: [e.g., openai.gpt5, anthropic.claude, etc.]

### Stage Requirements

Select which stages to implement (✓ = implement with logic, ✗ = stub only):
- [ ] ingestion - Load and shape input data
- [ ] preProcessing - Clean and prepare data
- [ ] promptTemplating - Generate prompts for LLM
- [ ] inference - Execute LLM calls
- [ ] parsing - Extract structured data from responses
- [ ] validateStructure - Check format and schema
- [ ] validateQuality - Assess content quality
- [ ] critique - Analyze results against criteria
- [ ] refine - Improve outputs iteratively
- [ ] finalValidation - Final checks before output
- [ ] integration - Connect to downstream systems

### Stage-Specific Logic

For each selected stage, provide:

**[Stage Name]**:
- Input: [What data/artifacts this stage needs]
- Processing: [Core logic to implement]
- Output: [What this stage produces]
- Side effects: [Files to write, external calls]

### Data Flow Example
```
ingestion: { field, roleId } →
promptTemplating: { system, user } →
inference: { response } →
parsing: { structured_data } →
...
```

### Artifacts & I/O
- Input artifacts: [List files to read, e.g., meta.json, config.json]
- Output artifacts: [List files to write, e.g., results.json, report.md]
- External APIs: [Any third-party services]

### Error Handling
- Critical stages: [Stages that must succeed]
- Fallback behavior: [What to do on failures]
- Validation rules: [Key constraints to enforce]

### Code Style Preferences
- Comments: [minimal/moderate/comprehensive]
- Validation depth: [basic/thorough/exhaustive]
- Modularity: [inline/extracted functions/separate utilities]

---

## Example Usage

Here's how someone would fill out this template:

### Workflow Details
**Purpose**: Generate a comprehensive analysis of market trends in a specific industry
**Domain**: Market research and analysis
**Primary Model**: openai.gpt5

### Stage Requirements
- [✓] ingestion - Load industry parameters and data sources
- [✓] preProcessing - Clean and normalize market data
- [✓] promptTemplating - Create analysis prompts
- [✓] inference - Get market analysis from LLM
- [✓] parsing - Extract key insights and metrics
- [✓] validateQuality - Check analysis completeness
- [✗] critique - (stub only)
- [✓] refine - Enhance with additional data points
- [✓] finalValidation - Verify all requirements met
- [✗] integration - (stub only)

### Stage-Specific Logic

**ingestion**:
- Input: config.json with industry, timeframe, focus_areas
- Processing: Load configuration, validate parameters, fetch initial dataset
- Output: { industry, timeframe, dataSources, focusAreas }
- Side effects: Read config.json, market-data.json

**promptTemplating**:
- Input: Industry parameters from ingestion
- Processing: Build comprehensive analysis prompt with specific metrics
- Output: { systemPrompt, userPrompt, analysisFramework }
- Side effects: None

**inference**:
- Input: Prompts from promptTemplating
- Processing: Call GPT-5 with structured output format
- Output: { rawAnalysis, confidence_scores }
- Side effects: Write raw-analysis.json

**parsing**:
- Input: Raw analysis from inference
- Processing: Extract trends, metrics, recommendations
- Output: { trends: [], metrics: {}, recommendations: [] }
- Side effects: None

**validateQuality**:
- Input: Parsed data
- Processing: Check completeness, verify data quality scores
- Output: { isValid, qualityScore, gaps: [] }
- Side effects: Write validation-report.json

**refine**:
- Input: Parsed data and validation results
- Processing: Fill gaps, enhance weak areas with follow-up queries
- Output: { refinedAnalysis, iterations }
- Side effects: Write final-analysis.json

### Output Example Structure

The generator would produce a file like:

```javascript
// Market Analysis Workflow
// Generated for: Market research and analysis

// Step 1: Ingestion - Load industry parameters and data sources
export const ingestion = async ({ io, llm, data, meta, flags }) => {
  try {
    const configContent = await io.readArtifact("config.json");
    const { industry, timeframe, focusAreas } = JSON.parse(configContent);
    
    // Validate required fields
    if (!industry || !timeframe) {
      throw new Error("Missing required configuration: industry and timeframe");
    }
    
    // Load market data if available
    let marketData = {};
    try {
      const dataContent = await io.readArtifact("market-data.json");
      marketData = JSON.parse(dataContent);
    } catch (e) {
      // Market data is optional
      console.log("No initial market data provided, proceeding without");
    }
    
    return {
      output: {
        industry,
        timeframe,
        focusAreas: focusAreas || ["trends", "opportunities", "risks"],
        marketData,
        dataSources: marketData.sources || []
      },
      flags: { ...flags, hasInitialData: !!marketData.sources }
    };
  } catch (error) {
    throw new Error(`Ingestion failed: ${error.message}`);
  }
};

// ... (additional stages with similar detailed implementation)
```

## Prompt Variations

### Minimal Version
"Create a JavaScript LLM workflow for [PURPOSE] that implements [STAGES] using [MODEL]. Focus on [KEY_FUNCTIONALITY]."

### Detailed Version
Use the full template above with all sections completed.

### Quick Start Examples

1. **Research Assistant**:
   "Generate a workflow for researching and summarizing academic papers. Implement ingestion (load topics), promptTemplating (create research queries), inference (GPT-5), and parsing (extract citations and summaries)."

2. **Content Generator**:
   "Create a workflow for blog post generation. Include ingestion (topic and style), promptTemplating (outline and content prompts), inference (Claude), validateQuality (readability checks), and refine (improve based on criteria)."

3. **Data Processor**:
   "Build a workflow for processing survey responses. Implement ingestion (load CSV), preProcessing (clean data), promptTemplating (analysis prompts), inference (GPT-5), parsing (extract insights), and integration (export to dashboard)."

## Key Patterns to Follow

1. **Stage Communication**: Each stage accesses previous outputs via `data.<stageName>.propertyName`
2. **Error Handling**: Use try-catch blocks for I/O operations and external calls
3. **Artifact Management**: Read with `io.readArtifact()`, write with `io.writeArtifact()`
4. **LLM Calls**: Access models via `llm.<provider>.<model>()` pattern
5. **Progressive Enhancement**: Later stages build upon earlier outputs
6. **Validation Gates**: Include checks that can halt workflow if critical issues found

## Advanced Features

### Conditional Stage Execution
```javascript
if (flags.requiresValidation) {
  // Run validation logic
}
```

### Multi-Model Support
```javascript
const response = flags.useAdvancedModel 
  ? await llm.openai.gpt5({...})
  : await llm.openai.gpt4({...});
```

### Iterative Refinement
```javascript
let refined = initial;
for (let i = 0; i < maxIterations; i++) {
  refined = await refineWithLLM(refined);
  if (meetsQuality(refined)) break;
}
```

This template allows users to specify exactly what they need while ensuring consistent, production-ready code output.
