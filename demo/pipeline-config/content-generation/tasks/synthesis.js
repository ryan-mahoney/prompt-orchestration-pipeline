// Synthesis Task - Combine analysis outputs into coherent narrative

export const synthesisJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["title", "paragraphs", "conclusion"],
  properties: {
    title: {
      type: "string",
      minLength: 1,
    },
    paragraphs: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        minLength: 1,
      },
    },
    conclusion: {
      type: "string",
      minLength: 1,
    },
  },
};

export const preProcessing = async ({
  data: {
    seed: {
      data: { type: analysisType },
    },
  },
  flags,
  io,
}) => {
  const researchContent = await io.readArtifact("research-output.json");
  const { researchSummary, keyFindings } = JSON.parse(researchContent);

  const analysisContent = await io.readArtifact("analysis-output.json");
  const { reaction, insightByArea } = JSON.parse(analysisContent);

  return {
    output: {
      researchSummary,
      keyFindings,
      reaction,
      insightByArea,
      analysisType,
    },
    flags,
  };
};

export const promptTemplating = ({
  data: {
    preProcessing: {
      researchSummary,
      keyFindings,
      reaction,
      insightByArea,
      analysisType,
    },
  },
  flags,
}) => {
  const system =
    "You are an expert writer skilled at synthesizing multiple analyses into a coherent narrative.";
  const prompt = `As Malcolm Gladwell, synthesize the following ${analysisType} analyses into a quirkily engaging and informative narrative.:

RESEARCH SUMMARY:
${researchSummary}

KEY FINDINGS:
${keyFindings
  .map(
    (kf, index) =>
      `Finding ${index + 1}:\nArea: ${kf.area}\nFindings: ${kf.findings}\nSources: ${kf.sources.join(
        ", "
      )}`
  )
  .join("\n\n")}
  
ANALYST REACTION:
${reaction}

INSIGHTS BY AREA:
${insightByArea
  .map((ia) => `Area: ${ia.area}\nInsight: ${ia.insight}`)
  .join("\n\n")}
  
SYNTHESIZE these elements into a single, engaging narrative that weaves together the key points with flair and insight.

Ensure the narrative flows smoothly, captures the essence of the analyses, and reflects Malcolm Gladwell's distinctive storytelling style.

IMPORTANT: You must respond with a valid JSON object only. Do not include any text before or after the JSON. Your response MUST follow this exact structure:

{
  "title": "Title of the synthesized narrative",
  "paragraphs": [
    "First paragraph of the narrative.",
    "Second paragraph of the narrative.",
    "...",
  ],
  "conclusion": "A compelling conclusion that ties everything together."
}

STRICT REQUIREMENTS:
- Provide ALL top-level fields exactly as named above.
- "paragraphs" MUST be an array of strings, each representing a distinct paragraph in the narrative.
- Be vivid and engaging, capturing the reader's interest throughout.

Now produce ONLY the JSON object in the specified structure.
`;

  return {
    output: { system, prompt },
    flags,
  };
};

export const inference = async ({
  io,
  llm: { openai },
  data: {
    promptTemplating: { system, prompt },
  },
  flags,
}) => {
  const response = await openai.gpt5Mini({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  await io.writeArtifact("synthesis-output.json", content);

  return {
    output: {},
    flags,
  };
};

export const validateStructure = async ({
  io,
  flags,
  validators: { validateWithSchema },
}) => {
  const synthesisContent = await io.readArtifact("synthesis-output.json");
  const result = validateWithSchema(synthesisJsonSchema, synthesisContent);

  if (!result.valid) {
    console.warn(
      "[Synthesis:validateStructure] Validation failed",
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
