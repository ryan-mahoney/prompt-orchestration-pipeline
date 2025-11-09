// Research Task - Gather information based on seed input
import { test } from "../libs/test.js";

export const researchJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: [
    "researchSummary",
    "keyFindings",
    "additionalInsights",
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
        additionalProperties: false,
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
    researchCompleteness: {
      type: "string",
      minLength: 1,
    },
  },
};

// Step 1: Load and prepare input data
export const ingestion = ({
  io,
  llm,
  data: {
    seed: {
      data: { topic, focusAreas, requirements },
    },
  },
  meta,
  flags,
}) => ({
  output: {
    topic,
    focusAreas,
    requirements,
  },
  flags,
});

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
  llm: { deepseek },
  data: {
    promptTemplating: { system, prompt },
  },
  meta,
  flags,
}) => {
  const response = await deepseek.chat({
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
    return {
      output: {},
      flags: { ...flags, validationFailed: true },
    };
  }

  return {
    output: {},
    flags,
  };
};
