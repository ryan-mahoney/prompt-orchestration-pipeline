# LLM Pipeline Phases Documentation

## Overview

This document describes the standard phases in an LLM task pipeline. Each phase serves a specific purpose in the progression from input data to validated, high-quality output. All phases execute sequentially, using flags to communicate state between stages rather than conditionally skipping stages.

## Architecture Principles

- **Sequential Execution**: All stages run in order, regardless of success/failure states
- **Flag-Based Communication**: Stages communicate through flags rather than exceptions
- **Separation of Concerns**: Structural validation is programmatic, quality validation is LLM-based
- **Self-Improving**: The pipeline can detect and correct its own quality issues through critique and refinement

## Phase Descriptions

### 1. **Ingestion**

**Purpose**: Load and extract raw input data from the seed  
**Responsibility**:

- Read input parameters from the seed data
- Extract required fields (e.g., topic, focus areas, requirements)
- Pass data forward in a consistent format

**Example Output**:

```javascript
{
  topic: "climate change",
  focusAreas: ["causes", "effects", "solutions"],
  requirements: "Include recent data"
}
```

---

### 2. **PreProcessing**

**Purpose**: Normalize and prepare input data for prompt creation  
**Responsibility**:

- Clean and standardize input formats
- Enrich data with defaults if needed
- Handle edge cases in input data
- Transform data into prompt-ready format

**Typical Operations**:

- Text normalization (trim, lowercase where appropriate)
- Array deduplication
- Setting default values for optional parameters
- Input validation and sanitization

---

### 3. **PromptTemplating**

**Purpose**: Build structured prompts for the LLM  
**Responsibility**:

- Create system prompts that define the LLM's role
- Build user prompts with clear instructions
- Include output format specifications
- Incorporate any domain-specific requirements

**Output Structure**:

```javascript
{
  system: "You are a research assistant...",
  prompt: "Research the following topic...\n[SPECIFIC INSTRUCTIONS]"
}
```

---

### 4. **Inference**

**Purpose**: Execute the LLM call with the prepared prompts  
**Responsibility**:

- Call the LLM API with the formatted prompts
- Handle the raw response from the model
- Write initial output to artifacts
- Perform basic response normalization

**Key Actions**:

- Make the API call to the LLM
- Parse string responses to JSON if needed
- Save output to artifact files for downstream stages
- Handle API errors gracefully

---

### 5. **Parsing**

**Purpose**: Transform LLM raw output into typed/structured format  
**Responsibility**:

- Convert model output to consistent object structure
- Handle various response formats (string vs object)
- Extract nested data structures
- Prepare data for validation

**Note**: Often a pass-through if inference already handles parsing

---

### 6. **ValidateStructure**

**Purpose**: Validate response structure against JSON schema  
**Responsibility**:

- Check JSON validity
- Validate against predefined schema
- Ensure all required fields are present
- Verify data types match expectations

**Sets Flags**:

- `validationFailed: true` if structure is invalid
- Logs specific validation errors for debugging

---

### 7. **ValidateQuality**

**Purpose**: Perform LLM-based content quality assessment  
**Responsibility**:

- Evaluate factual consistency
- Check completeness of coverage
- Assess depth and specificity
- Verify requirements are met
- Identify logical gaps or contradictions

**Implementation**: Uses an LLM call to evaluate quality aspects that cannot be checked programmatically

**Example Quality Checks**:

```javascript
-"Are all focus areas adequately addressed?" -
  "Is there internal consistency in the facts presented?" -
  "Does the response meet minimum depth requirements?" -
  "Are sources credible and properly cited?";
```

**Sets Flags**:

- `validationFailed: true` if quality issues found
- `qualityIssues: [...]` with specific problems identified

---

### 8. **Critique**

**Purpose**: Generate specific improvement instructions when quality issues exist  
**Responsibility**:

- Analyze what went wrong with the response
- Create actionable feedback for improvement
- Prioritize issues to address
- Provide concrete guidance for refinement

**Behavior**:

- Always runs but produces different outputs based on validation state
- If validation passed: Sets `critiqueComplete: true` with no actions
- If validation failed: Generates detailed improvement instructions

**Output Example**:

```
"Add specific statistics for the causes section,
expand the solutions with implementation timelines,
fix the contradiction between paragraphs 2 and 5"
```

---

### 9. **Refine**

**Purpose**: Re-run the core task with critique-based enhancements  
**Responsibility**:

- Incorporate critique guidance into enhanced prompts
- Call LLM again with improvements
- Update output artifacts with refined response
- Maintain original requirements while addressing issues

**Behavior**:

- Only performs refinement if `validationFailed: true`
- Augments original prompt with critique guidance
- Overwrites the output artifact with improved version

**Sets Flags**:

- `refined: true` if refinement was performed
- `skipRefinement: true` if no refinement was needed

---

### 10. **FinalValidation**

**Purpose**: Ensure refined output still meets structural requirements  
**Responsibility**:

- Re-validate JSON schema compliance after refinement
- Catch any structural breaks introduced during refinement
- Provide final gate before integration
- Ensure output is still machine-parseable

**Why This Matters**: LLMs can sometimes break JSON structure when following complex refinement instructions

**Sets Flags**:

- `finalValidationPassed: true` if structure is valid
- `structureBrokenByRefinement: true` if refinement broke the schema

---

### 11. **Integration**

**Purpose**: Persist and organize final results for downstream consumption  
**Responsibility**:

- Write final artifacts to appropriate locations
- Prepare output for next pipeline stage
- Log completion status
- Handle any cleanup operations

**Typical Actions**:

- Save to database
- Write to file system
- Trigger downstream workflows
- Send notifications

---

## Flag Communication Pattern

The pipeline uses flags to maintain state across phases:

```javascript
flags = {
  // Validation states
  needsRefinement: boolean,
  qualityIssues: string[],

  // Process tracking
  critiqueComplete: boolean,
  refined: boolean,
  skipRefinement: boolean,

  // Final states
  finalValidationPassed: boolean,
  structureBrokenByRefinement: boolean
}
```

## Benefits of This Architecture

1. **Predictable Execution**: Same stages always run in the same order
2. **Better Observability**: Can log/monitor each stage even when it's a no-op
3. **Simpler Orchestration**: No complex conditional branching logic
4. **Easier Testing**: Each stage can be tested independently
5. **Self-Correcting**: Automatic quality improvement through critique/refine cycle
6. **Robust**: Structural validation bookends prevent malformed outputs

## Example Flow

Given a research task about "renewable energy":

1. **Ingestion** → Extract topic and focus areas
2. **PreProcessing** → Normalize input text
3. **PromptTemplating** → Create research prompt
4. **Inference** → LLM generates research JSON
5. **Parsing** → Ensure JSON format
6. **ValidateStructure** → ✅ Valid JSON schema
7. **ValidateQuality** → ❌ "Lacks specific statistics"
8. **Critique** → "Add quantitative data for solar and wind sections"
9. **Refine** → Re-run with enhanced prompt
10. **FinalValidation** → ✅ Still valid JSON
11. **Integration** → Save to `research-output.json`

This creates a self-improving pipeline that can recover from initial failures while maintaining structural integrity throughout the process.
