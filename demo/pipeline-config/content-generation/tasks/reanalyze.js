// Analysis Task - Analyze research findings and extract insights

export const analysisJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["reaction", "insightByArea"],
  properties: {
    reaction: {
      type: "string",
      minLength: 1,
    },
    insightByArea: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "alternatePerspective", "implications"],
        properties: {
          area: {
            type: "string",
            minLength: 1,
          },
          alternatePerspective: {
            type: "string",
            minLength: 1,
          },
          implications: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
  },
};

// Step 1: Load and prepare input data
export const ingestion = async ({
  io,
  llm,
  data: {
    seed: {
      data: { type: analysisType },
    },
  },
  meta,
  flags,
}) => {
  const researchContent = await io.readArtifact("research-output.json");
  const { researchSummary, keyFindings, additionalInsights } =
    JSON.parse(researchContent);

  return {
    output: {
      analysisType,
      researchSummary,
      keyFindings,
      additionalInsights,
    },
    flags,
  };
};

// Step 2: Build LLM prompts
export const promptTemplating = ({
  io,
  llm,
  data: {
    ingestion: {
      researchSummary,
      keyFindings,
      additionalInsights,
      analysisType,
    },
  },
  meta,
  flags,
}) => {
  return {
    output: {
      system:
        "You are an expert analyst skilled at extracting insights from research data. Always respond with valid JSON only.",
      prompt: `As Nassim Nicholas Taleb, analyze the following research and provide a contrarian perspective in a validation-friendly structure.

RESEARCH INPUT:
${researchSummary}

ANALYSIS TYPE: ${analysisType}

KEY FINDINGS:
${keyFindings
  .map(
    (kf, index) =>
      `Finding ${index + 1}:\nArea: ${kf.area}\nFindings: ${kf.findings}\nSources: ${
        Array.isArray(kf.sources) ? kf.sources.join(", ") : "N/A"
      }`
  )
  .join("\n\n")}

IMPORTANT: You must respond with a valid JSON object only. Do not include any text before or after the JSON. Your response MUST follow this exact structure:

{
  "reaction": "Brief impression of the research findings from a contrarian viewpoint",
  "insightByArea": [
    {
      "area": "MUST match one of research.keyFindings[].area exactly",
      "alternatePerspective": "<contrarian perspective> for this area",
      "implications": "What this means and why it matters",
    }
  ]
}

STRICT REQUIREMENTS:
- Provide ALL top-level fields exactly as named above.
- "insightByArea" MUST contain one entry per area in research.keyFindings[].area (if appropriate), with "area" strings exactly matching the research JSON.
- Be specific and actionable. Avoid vague advice.

Now produce ONLY the JSON object in the specified structure.`,
    },
    flags,
  };
};

// Step 3: Call LLM with prompt
export const inference = async ({
  io,
  llm: { anthropic },
  data: {
    promptTemplating: { system, prompt },
  },
  meta,
  flags,
}) => {
  //throw new Error("Disabled for demo purposes");

  const response = await anthropic.sonnet45({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  await io.writeArtifact("analysis-output.json", content);

  return {
    output: {},
    flags,
  };
};

// Step 4: Validate prompt response structure using JSON schema
export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const analysisContent = await io.readArtifact("analysis-output.json");
  const result = validateWithSchema(analysisJsonSchema, analysisContent);

  if (!result.valid) {
    console.warn(
      "[Analysis:validateStructure] Validation failed",
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
