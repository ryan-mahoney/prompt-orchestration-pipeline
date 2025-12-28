// Research Task - Gather information based on seed input
import { test } from "../libs/test.js";
import { initAuditBranch, commitTaskArtifacts } from "../libs/git-audit.js";

export const researchJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: true,
  required: [
    "researchSummary",
    "keyFindings",
    "additionalInsights",
    "criticalPerspectives",
    "researchCompleteness",
  ],
  properties: {
    researchSummary: {
      type: "string",
      minLength: 1,
    },
    keyFindings: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["area", "findings"],
        properties: {
          area: {
            type: "string",
            minLength: 1,
          },
          findings: {
            type: "string",
            minLength: 1,
          },
          sources: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
    },
    additionalInsights: {
      type: "string",
    },
    criticalPerspectives: {
      type: "string",
      minLength: 1,
    },
    researchCompleteness: {
      type: "string",
      minLength: 1,
    },
  },
};

// Step 1: Load and prepare input data
export const ingestion = async ({
  io,
  llm,
  data: {
    seed,
    seed: {
      data: { topic, focusAreas, requirements },
    },
  },
  meta,
  flags,
}) => {
  // Initialize git audit branch for this pipeline run
  try {
    await initAuditBranch(meta.jobId, seed.pipeline, seed.data);
  } catch (err) {
    console.warn('[research:ingestion] Git audit init failed (continuing):', err.message);
  }

  return {
    output: {
      topic,
      focusAreas,
      requirements,
    },
    flags,
  };
};

// Step 2: Optional preprocessing - normalize/prepare input for prompt creation
// Contract: read from prior stage (ingestion) and produce preprocessed output for templating
export const preProcessing = ({
  io,
  llm,
  data: { ingestion },
  meta,
  flags,
  output,
}) => {
  // Pass-through for now; implement normalization/enrichment here if needed
  return {
    output: output ?? ingestion,
    flags,
  };
};

// Step 3: Build LLM prompts
export const promptTemplating = ({
  io,
  llm,
  data: {
    ingestion: { focusAreas, topic },
  },
  meta,
  flags,
}) => {
  test();
  return {
    output: {
      system:
        "You are a research assistant specializing in comprehensive information gathering. Always respond with valid JSON only.",
      prompt: `Research the following topic: ${topic}

Focus areas:
${focusAreas.map((area) => `- ${area}`).join("\n")}

Provide detailed, factual information with sources where possible.

IMPORTANT: You must respond with a valid JSON object only. Do not include any text before or after the JSON. Your response should follow this exact structure:

{
  "researchSummary": "Brief overview of the research findings",
  "keyFindings": [
    {
      "area": "name of focus area",
      "findings": "detailed information about this area",
      "sources": ["source1", "source2"] (optional)
    }
  ],
  "additionalInsights": "any other relevant information",
  "criticalPerspectives": "critical analysis and potential concerns about the topic",
  "researchCompleteness": "assessment of how thoroughly the topic was covered"
}

Ensure your JSON is properly formatted with:
- All strings properly quoted
- No trailing commas
- Properly nested brackets and braces
- Valid escape sequences for special characters

Now provide your research findings in the specified JSON format:`,
    },
    flags,
  };
};

// Step 4: Call LLM with prompt
export const inference = async ({
  io,
  llm: { anthropic },
  data: {
    promptTemplating: { system, prompt },
  },
  meta,
  flags,
}) => {
  const response = await anthropic.opus45({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  // Normalize model output to ensure canonical JSON object
  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  await io.writeArtifact(
    "research-output.json",
    JSON.stringify(parsed, null, 2)
  );

  return {
    output: {},
    flags,
  };
};

// Step 5: Parse/normalize LLM raw output into typed/structured shape
// Contract: convert model output into a consistent object; may read artifacts if needed
export const parsing = ({ io, llm, data, meta, flags, output }) => {
  // Pass-through for now; implement JSON parsing/normalization here if needed
  return {
    output, // keep last stage output unchanged
    flags,
  };
};

// Step 6: Validate prompt response structure using JSON schema
export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const researchContent = await io.readArtifact("research-output.json");
  const result = validateWithSchema(researchJsonSchema, researchContent);

  if (!result.valid) {
    console.warn(
      "[Research:validateStructure] Validation failed",
      result.errors
    );
    throw new Error(
      `Schema validation failed: ${JSON.stringify(result.errors)}`
    );
  }

  return {
    output: {},
    flags,
  };
};

// Step 7: Quality validation (optional) — domain-specific checks beyond schema
// Contract: set flags.needsRefinement=true to trigger critique/refine/finalValidation loop
export const validateQuality = ({ io, llm, data, meta, flags, output }) => {
  // normally this would be done by LLM analysis, but for demo purposes we hardcode a failure
  return {
    output: {
      feedback:
        "Research must include an additional negative or critical information.",
    },
    flags: { needsRefinement: true },
  };
};

// Step 8: Critique (optional) — analyze failures and propose improvements
// Contract: runs when not explicitly skipped; should set critiqueComplete when implemented
export const critique = async ({
  io,
  llm: { anthropic },
  data: {
    validateQuality: { feedback },
    promptTemplating: { prompt },
  },
  meta,
  flags,
  output,
}) => {
  // Analyze feedback and original prompt, call LLM to generate a revised prompt, and return the result.

  const template = {
    system:
      "You are an expert in research analysis who can look at an LLM prompt, see its shortcomings, and suggest improvements by evaluating ORIGINAL_PROMPT and FEEDBACK and generating a json object in the same structure as ORIGINAL_PROMPT. Don't drop any important details from the original prompt. Always respond with valid JSON only.",
    prompt: `ORIGINAL_PROMPT: ${prompt}

- - -
    
FEEDBACK: ${feedback}

- - -

INSTRUCTIONS: Based on the ORIGINAL_PROMPT and FEEDBACK, generate a new prompt in JSON format that addresses the feedback while maintaining the original intent. Ensure the output is a valid JSON object suitable for LLM input.

OUTPUT FORMAT:
{
  "prompt": "string"
}`,
  };

  const response = await anthropic.sonnet45({
    messages: [
      { role: "system", content: template.system },
      { role: "user", content: JSON.stringify(template) },
    ],
  });

  // Normalize model output to ensure canonical JSON object
  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  return {
    output: {
      revisedPrompt: parsed.prompt,
    },
    flags,
  };
};

// Step 9: Refine (optional) — apply critique to produce an improved output
// Contract: can depend on flags.needsRefinement; should set refined=true when implemented
export const refine = async ({
  io,
  llm: { anthropic },
  data: {
    critique: { revisedPrompt },
    promptTemplating: { system },
  },
  meta,
  flags,
  output,
}) => {
  const response = await anthropic.sonnet45({
    messages: [
      { role: "system", content: system },
      { role: "user", content: revisedPrompt },
    ],
  });

  await io.writeArtifact("research-revisedPrompt.txt", revisedPrompt);

  // Normalize model output to ensure canonical JSON object
  let parsed;
  if (typeof response.content === "string") {
    parsed = JSON.parse(response.content);
  } else if (
    typeof response.content === "object" &&
    response.content !== null
  ) {
    parsed = response.content;
  } else {
    throw new Error(
      "LLM response content must be a JSON object or a JSON stringified object"
    );
  }

  await io.writeArtifact(
    "research-output-2.json",
    JSON.stringify(parsed, null, 2)
  );

  // Refine output by calling LLM, parsing response, and writing artifacts
  return {
    output,
    flags,
  };
};

// Step 10: Final validation — ensure refined output satisfies all constraints
// Contract: last validation gate; throws an error on validation failure
export const finalValidation = async ({
  io,
  llm,
  data,
  meta,
  flags,
  output,
  validators: { validateWithSchema },
}) => {
  const researchContent = await io.readArtifact("research-output-2.json");
  const result = validateWithSchema(researchJsonSchema, researchContent);

  if (!result.valid) {
    console.warn("[Research:finalValidation] Validation failed", result.errors);
    throw new Error(
      `Final schema validation failed: ${JSON.stringify(result.errors)}`
    );
  }

  await io.writeArtifact("research-output.json", researchContent);

  return {
    output: {},
    flags,
  };
};

// Step 11: Integration — persist, organize, or hand off final results
// Contract: write artifacts or produce a final payload for downstream tasks
export const integration = async ({ io, llm, data, meta, flags, output }) => {
  // Commit research artifacts to git audit branch
  try {
    const researchOutput = await io.readArtifact("research-output.json");

    await commitTaskArtifacts("research", {
      "research-output.json": researchOutput,
    }, {
      prompt: data.promptTemplating?.prompt,
      systemPrompt: data.promptTemplating?.system,
      model: "anthropic:opus-4.5",
    });
  } catch (err) {
    console.warn('[research:integration] Git audit commit failed (continuing):', err.message);
  }

  return {
    output,
    flags,
  };
};
