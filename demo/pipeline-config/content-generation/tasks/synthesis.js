// Synthesis Task - Combine analysis outputs into coherent narrative

export async function ingestion(context) {
  console.log("[Synthesis:ingestion] Starting data ingestion");
  try {
    const { artifacts } = context;
    const analysis = artifacts?.analysis?.analysis;

    if (!analysis) {
      throw new Error("Analysis data not found in artifacts");
    }

    const result = {
      output: {
        analyses: Array.isArray(analysis) ? analysis : [analysis],
        synthesisType: context.seed.data.synthesisType || "narrative",
      },
      flags: {},
    };

    console.log(
      "[Synthesis:ingestion] ✓ Successfully ingested data:",
      JSON.stringify(
        {
          analysisCount: result.output.analyses.length,
          synthesisType: result.output.synthesisType,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Synthesis:ingestion] ✗ Error during ingestion:",
      error.message
    );
    throw error;
  }
}

export async function preProcessing(context) {
  console.log("[Synthesis:preProcessing] Preparing synthesis inputs");
  try {
    const { analyses, synthesisType } = context.output;

    // Combine all analysis contents for processing
    const combinedContent = analyses
      .map((analysis, index) => `Analysis ${index + 1}:\n${analysis.content}`)
      .join("\n\n");

    const result = {
      output: {
        ...context.output,
        combinedContent,
      },
      flags: {},
    };

    console.log(
      "[Synthesis:preProcessing] ✓ Preprocessing completed:",
      JSON.stringify(
        {
          combinedLength: combinedContent.length,
          analysisCount: analyses.length,
        },
        null,
        2
      )
    );

    return result;
  } catch (error) {
    console.error(
      "[Synthesis:preProcessing] ✗ Error during preprocessing:",
      error.message
    );
    throw error;
  }
}

export async function promptTemplating(context) {
  console.log("[Synthesis:promptTemplating] Building prompt template");
  try {
    const { combinedContent, synthesisType } = context.output;

    const result = {
      output: {
        ...context.output,
        system:
          "You are an expert writer skilled at synthesizing multiple analyses into a coherent narrative.",
        prompt: `Synthesize the following analyses into a ${synthesisType}:

${combinedContent}

Create a unified narrative that:
1. Integrates all key findings
2. Identifies patterns across analyses
3. Provides comprehensive recommendations
4. Maintains professional tone and clarity`,
      },
      flags: {},
    };

    console.log("[Synthesis:promptTemplating] ✓ Prompt template created");
    return result;
  } catch (error) {
    console.error(
      "[Synthesis:promptTemplating] ✗ Error creating prompt:",
      error.message
    );
    throw error;
  }
}

export async function inference(context) {
  console.log("[Synthesis:inference] Starting LLM inference");
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
        synthesisContent: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
        },
      },
      flags: {},
    };

    console.log(
      "[Synthesis:inference] ✓ Inference completed:",
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
      "[Synthesis:inference] ✗ Error during inference:",
      error.message
    );
    throw error;
  }
}

export async function validateStructure(context) {
  console.log("[Synthesis:validateStructure] Validating synthesis content");
  try {
    const { synthesisContent } = context.output;

    let validationFailed = false;
    let lastValidationError = undefined;

    if (!synthesisContent || synthesisContent.length < 50) {
      console.error(
        "[Synthesis:validateStructure] ✗ Validation failed: Content too short or missing"
      );
      validationFailed = true;
      lastValidationError = "Synthesis content too short or missing";
    } else {
      console.log(
        "[Synthesis:validateStructure] ✓ Validation passed:",
        JSON.stringify(
          {
            contentLength: synthesisContent.length,
          },
          null,
          2
        )
      );
    }

    return {
      output: {
        validationResult: {
          contentLength: synthesisContent?.length || 0,
          passed: !validationFailed,
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
      "[Synthesis:validateStructure] ✗ Error during validation:",
      error.message
    );
    throw error;
  }
}

export async function integration(context) {
  console.log("[Synthesis:integration] Integrating synthesis output");
  try {
    const { synthesisContent, metadata } = context.output;

    const result = {
      output: {
        synthesis: {
          content: synthesisContent,
          metadata,
          timestamp: new Date().toISOString(),
        },
      },
      flags: {},
    };

    console.log("[Synthesis:integration] ✓ Integration completed");
    return result;
  } catch (error) {
    console.error(
      "[Synthesis:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
