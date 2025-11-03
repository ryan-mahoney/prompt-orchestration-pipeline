// Synthesis Task - Combine analysis outputs into coherent narrative

export const ingestion = ({
  data: {
    seed: { data: seed },
  },
  flags,
}) => {
  const analysis = seed.analysis;
  if (!analysis) {
    throw new Error("Analysis data not found in seed");
  }

  const analyses = Array.isArray(analysis) ? analysis : [analysis];
  const synthesisType = seed.synthesisType || "narrative";

  return {
    output: { analyses, synthesisType },
    flags,
  };
};

export const preProcessing = ({
  data: {
    ingestion: { analyses, synthesisType },
  },
  flags,
}) => {
  // Combine all analysis contents for processing
  const combinedContent = analyses
    .map((analysis, index) => `Analysis ${index + 1}:\n${analysis.content}`)
    .join("\n\n");

  return {
    output: { combinedContent, synthesisType },
    flags,
  };
};

export const promptTemplating = ({
  data: {
    preProcessing: { combinedContent, synthesisType },
  },
  flags,
}) => {
  const system =
    "You are an expert writer skilled at synthesizing multiple analyses into a coherent narrative.";
  const prompt = `Synthesize the following analyses into a ${synthesisType}:

${combinedContent}

Create a unified narrative that:
1. Integrates all key findings
2. Identifies patterns across analyses
3. Provides comprehensive recommendations
4. Maintains professional tone and clarity`;

  return {
    output: { system, prompt },
    flags,
  };
};

export const inference = async ({
  io,
  llm: { deepseek },
  data: {
    promptTemplating: { system, prompt },
  },
  flags,
}) => {
  const response = await deepseek.chat({
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
    output: {
      metadata: {
        model: response.model,
        tokens: response.usage?.total_tokens,
      },
    },
    flags,
  };
};

export const validateStructure = async ({ io, flags }) => {
  const raw = await io.readArtifact("synthesis-output.json");
  let validationFailed = false;
  let validationResult = {};

  try {
    const content = raw; // LLM output is text, not JSON
    if (!content || content.length < 50) {
      console.warn("[validateStructure] ⚠ Content too short or missing");
      validationFailed = true;
      validationResult = {
        contentLength: content?.length || 0,
        passed: false,
        error: "Synthesis content too short or missing",
      };
    } else {
      validationResult = {
        contentLength: content.length,
        passed: true,
      };
    }
  } catch (err) {
    console.warn("[validateStructure] ⚠ Validation failed:", err.message);
    validationFailed = true;
    validationResult = {
      contentLength: 0,
      passed: false,
      error: err.message,
    };
  }

  return {
    output: {
      validationResult: {
        ...validationResult,
        validatedAt: new Date().toISOString(),
      },
    },
    flags: { ...flags, validationFailed },
  };
};

export const integration = async ({
  io,
  data: {
    validateStructure: { validationResult },
    inference: { metadata },
  },
  flags,
}) => {
  const synthesisContent = await io.readArtifact("synthesis-output.json");

  return {
    output: {
      synthesis: {
        content: synthesisContent,
        metadata,
        validationResult,
        timestamp: new Date().toISOString(),
      },
    },
    flags,
  };
};
