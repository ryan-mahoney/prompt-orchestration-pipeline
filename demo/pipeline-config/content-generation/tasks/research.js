// Research Task - Gather information based on seed input
import { test } from "../libs/test.js";

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
  llm: { deepseek, openai },
  data: {
    promptTemplating: { system, prompt },
  },
  meta,
  flags,
}) => {
  const response = await openai.gpt5Mini({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  await io.writeArtifact(
    "research-output.json",
    JSON.stringify(response.content)
  );

  return {
    output: {},
    flags,
  };
};

// Step 6: Validate prompt response structure and completeness
export const validateStructure = async ({ io, llm, data, meta, flags }) => {
  const researchContent = await io.readArtifact("research-output.json");
  let jsonValid = false;
  let structureValid = false;

  try {
    const parsedContent = JSON.parse(researchContent);
    jsonValid = true;

    // Validate required fields
    const requiredFields = [
      "researchSummary",
      "keyFindings",
      "additionalInsights",
      "researchCompleteness",
    ];
    const missingFields = requiredFields.filter(
      (field) => !parsedContent.hasOwnProperty(field)
    );
    if (missingFields.length > 0) {
      structureValid = false;
    } else {
      structureValid = true;
    }
  } catch (parseError) {
    console.warn(
      `[Research:validateStructure] ⚠ JSON parsing failed: ${parseError.message}`
    );
  }

  return {
    output: {},
    flags: { ...flags, validationFailed: !(jsonValid && structureValid) },
  };
};
