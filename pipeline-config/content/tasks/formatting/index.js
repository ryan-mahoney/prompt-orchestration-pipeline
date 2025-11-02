// Formatting Task - Format final output according to specifications

export async function ingestion(context) {
  console.log("[Formatting:ingestion] Starting data ingestion");
  try {
    const { artifacts } = context;
    const synthesis = artifacts?.synthesis?.synthesis;

    const result = {
      output: {
        content: synthesis?.content,
        outputFormat: context.seed.data.outputFormat,
        metadata: synthesis?.metadata,
      },
      flags: {},
    };

    console.log(
      "[Formatting:ingestion] ✓ Successfully ingested data:",
      JSON.stringify(
        {
          hasContent: !!result.output.content,
          outputFormat: result.output.outputFormat,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Formatting:ingestion] ✗ Error during ingestion:",
      error.message
    );
    throw error;
  }
}

export async function preProcessing(context) {
  console.log("[Formatting:preProcessing] Determining format specifications");
  try {
    const { outputFormat } = context.output;

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

    const result = {
      output: {
        ...context.output,
        formatSpec:
          formatSpecs[outputFormat] || formatSpecs["executive-summary"],
      },
      flags: {},
    };

    console.log(
      "[Formatting:preProcessing] ✓ Format specifications determined:",
      JSON.stringify(
        {
          outputFormat,
          hasFormatSpec: !!result.output.formatSpec,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Formatting:preProcessing] ✗ Error during preprocessing:",
      error.message
    );
    throw error;
  }
}

export async function promptTemplating(context) {
  console.log("[Formatting:promptTemplating] Building prompt template");
  try {
    const { content, formatSpec } = context.output;

    const result = {
      output: {
        ...context.output,
        system:
          "You are a professional editor skilled at formatting content for different audiences and purposes.",
        prompt: `Format the following content according to these specifications:

CONTENT:
${content}

FORMAT SPECIFICATIONS:
${JSON.stringify(formatSpec, null, 2)}

Provide formatted output with proper structure, headings, and styling.`,
      },
      flags: {},
    };

    console.log("[Formatting:promptTemplating] ✓ Prompt template created");
    return result;
  } catch (error) {
    console.error(
      "[Formatting:promptTemplating] ✗ Error creating prompt:",
      error.message
    );
    throw error;
  }
}

export async function inference(context) {
  console.log("[Formatting:inference] Starting LLM inference");
  try {
    const pt = context.data?.promptTemplating;
    if (!pt?.system || !pt?.prompt) {
      throw new Error(
        "promptTemplating output missing required fields: system/prompt"
      );
    }
    const { system, prompt } = pt;

    const response = await context.llm.deepseek.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });

    const result = {
      output: {
        ...context.output,
        formattedContent: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
        },
      },
      flags: {},
    };

    console.log(
      "[Formatting:inference] ✓ Inference completed:",
      JSON.stringify(
        {
          model: result.output.metadata.model,
          tokens: result.output.metadata.tokens,
          contentLength: response.content.length,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Formatting:inference] ✗ Error during inference:",
      error.message
    );
    throw error;
  }
}

export async function validateStructure(context) {
  console.log("[Formatting:validateStructure] Validating formatted content");
  try {
    const { formattedContent, formatSpec } = context.output;
    let validationFailed = false;
    let lastValidationError = undefined;
    let missingSections = [];

    if (formatSpec.sections) {
      missingSections = formatSpec.sections.filter(
        (section) => !formattedContent.includes(section)
      );

      if (missingSections.length > 0) {
        console.error(
          "[Formatting:validateStructure] ✗ Validation failed: Missing sections:",
          JSON.stringify(missingSections, null, 2)
        );
        validationFailed = true;
        lastValidationError = `Missing sections: ${missingSections.join(", ")}`;
      } else {
        console.log(
          "[Formatting:validateStructure] ✓ Validation passed: All required sections present"
        );
      }
    } else {
      console.log(
        "[Formatting:validateStructure] ✓ No section validation required"
      );
    }

    return {
      output: {
        validationResult: {
          contentLength: formattedContent?.length || 0,
          passed: !validationFailed,
          missingSections,
          validatedAt: new Date().toISOString(),
        },
      },
      flags: {
        validationFailed,
        lastValidationError,
      },
    };
  } catch (error) {
    console.error(
      "[Formatting:validateStructure] ✗ Error during validation:",
      error.message
    );
    throw error;
  }
}

export async function integration(context) {
  console.log("[Formatting:integration] Integrating final output");
  try {
    const { formattedContent, metadata, formatSpec } = context.output;

    const result = {
      output: {
        finalOutput: {
          content: formattedContent,
          format: formatSpec,
          metadata: {
            ...metadata,
            wordCount: formattedContent.split(/\s+/).length,
            characterCount: formattedContent.length,
          },
          timestamp: new Date().toISOString(),
        },
      },
      flags: {},
    };

    console.log(
      "[Formatting:integration] ✓ Integration completed:",
      JSON.stringify(
        {
          wordCount: result.output.finalOutput.metadata.wordCount,
          characterCount: result.output.finalOutput.metadata.characterCount,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Formatting:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
