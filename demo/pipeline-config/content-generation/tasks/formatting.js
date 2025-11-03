// Formatting Task - Format final output according to specifications

export const ingestion = ({
  data: {
    seed: { data: seed },
  },
  flags,
}) => {
  const content = seed.synthesis?.content;
  const outputFormat = seed.outputFormat;
  const metadata = seed.synthesis?.metadata;

  if (!content) {
    throw new Error("Synthesis content not found in seed");
  }

  return {
    output: { content, outputFormat, metadata },
    flags,
  };
};

export const preProcessing = ({
  data: {
    ingestion: { outputFormat },
  },
  flags,
}) => {
  const formatSpecs = {
    "executive-summary": {
      sections: ["Executive Summary", "Key Findings", "Recommendations"],
      style: "professional, concise",
    },
    "blog-post": {
      sections: ["Introduction", "Main Content", "Conclusion"],
      style: "engaging, accessible",
    },
    "structured-json": {
      format: "JSON",
      style: "machine-readable",
    },
  };

  const formatSpec =
    formatSpecs[outputFormat] || formatSpecs["executive-summary"];

  return {
    output: { outputFormat, formatSpec },
    flags,
  };
};

export const promptTemplating = ({
  data: {
    ingestion: { content },
    preProcessing: { formatSpec },
  },
  flags,
}) => {
  const system =
    "You are a professional editor skilled at formatting content for different audiences and purposes.";
  const prompt = `Format the following content according to these specifications:

CONTENT:
${content}

FORMAT SPECIFICATIONS:
${JSON.stringify(formatSpec, null, 2)}

Provide formatted output with proper structure, headings, and styling.`;

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

  await io.writeArtifact("formatted-output.json", content);

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

export const finalValidation = async ({
  io,
  data: {
    preProcessing: { formatSpec },
  },
  flags,
}) => {
  const raw = await io.readArtifact("formatted-output.json");
  let validationFailed = false;
  let validationResult = {};

  try {
    const formattedContent = raw;
    let missingSections = [];

    if (formatSpec.sections) {
      missingSections = formatSpec.sections.filter(
        (section) => !formattedContent.includes(section)
      );

      if (missingSections.length > 0) {
        console.warn(
          "[finalValidation] ⚠ Missing sections:",
          missingSections.join(", ")
        );
        validationFailed = true;
        validationResult = {
          contentLength: formattedContent?.length || 0,
          passed: false,
          missingSections,
          error: `Missing sections: ${missingSections.join(", ")}`,
        };
      } else {
        validationResult = {
          contentLength: formattedContent.length,
          passed: true,
          missingSections: [],
        };
      }
    } else {
      validationResult = {
        contentLength: formattedContent.length,
        passed: true,
        missingSections: [],
      };
    }
  } catch (err) {
    console.warn("[finalValidation] ⚠ Validation failed:", err.message);
    validationFailed = true;
    validationResult = {
      contentLength: 0,
      passed: false,
      missingSections: [],
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
    ingestion: { metadata },
    preProcessing: { formatSpec },
    finalValidation: { validationResult },
    inference: { metadata: inferenceMetadata },
  },
  flags,
}) => {
  const formattedContent = await io.readArtifact("formatted-output.json");

  return {
    output: {
      finalOutput: {
        content: formattedContent,
        format: formatSpec,
        metadata: {
          ...metadata,
          ...inferenceMetadata,
          wordCount: formattedContent.split(/\s+/).length,
          characterCount: formattedContent.length,
        },
        validationResult,
        timestamp: new Date().toISOString(),
      },
    },
    flags,
  };
};
