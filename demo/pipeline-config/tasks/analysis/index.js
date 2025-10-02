// Analysis Task - Analyze research findings and extract insights

export async function ingestion(context) {
  console.log("[Analysis:ingestion] Starting data ingestion");
  try {
    const { artifacts } = context;
    const research = artifacts?.research?.research;

    if (!research) {
      console.error(
        "[Analysis:ingestion] ✗ Research data not found in artifacts"
      );
      throw new Error("Research data not found in artifacts");
    }

    const result = {
      output: {
        researchContent: research.content,
        analysisType: context.seed.data.type,
      },
    };

    console.log("[Analysis:ingestion] ✓ Successfully ingested data:", {
      researchContentLength: research.content.length,
      analysisType: context.seed.data.type,
    });

    return result;
  } catch (error) {
    console.error(
      "[Analysis:ingestion] ✗ Error during ingestion:",
      error.message
    );
    throw error;
  }
}

export async function promptTemplating(context) {
  console.log("[Analysis:promptTemplating] Building prompt template");
  try {
    const { researchContent, analysisType } = context.output;

    const result = {
      output: {
        ...context.output,
        system:
          "You are an expert analyst skilled at extracting insights from research data.",
        prompt: `Analyze the following research and provide key insights:

${researchContent}

Analysis type: ${analysisType}

Provide:
1. Key findings
2. Trends and patterns
3. Opportunities and challenges
4. Recommendations`,
      },
    };

    console.log("[Analysis:promptTemplating] ✓ Prompt template created");
    return result;
  } catch (error) {
    console.error(
      "[Analysis:promptTemplating] ✗ Error creating prompt:",
      error.message
    );
    throw error;
  }
}

export async function inference(context) {
  console.log("[Analysis:inference] Starting LLM inference");
  try {
    const { system, prompt } = context.output;
    const model = context.taskConfig?.model || "gpt-5-nano";

    console.log("[Analysis:inference] Using model:", model);

    const response = await context.llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      model,
      temperature: context.taskConfig?.temperature || 0.6,
      max_tokens: context.taskConfig?.maxTokens || 2500,
    });

    const result = {
      output: {
        ...context.output,
        analysisContent: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
        },
      },
    };

    console.log("[Analysis:inference] ✓ Inference completed:", {
      model: result.output.metadata.model,
      tokens: result.output.metadata.tokens,
      contentLength: response.content.length,
    });

    return result;
  } catch (error) {
    console.error(
      "[Analysis:inference] ✗ Error during inference:",
      error.message
    );
    throw error;
  }
}

export async function validateStructure(context) {
  console.log("[Analysis:validateStructure] Validating analysis content");
  try {
    const { analysisContent } = context.output;

    const requiredSections = ["findings", "trends", "recommendations"];
    const hasAllSections = requiredSections.every((section) =>
      analysisContent.toLowerCase().includes(section)
    );

    if (!hasAllSections) {
      const missingSections = requiredSections.filter(
        (section) => !analysisContent.toLowerCase().includes(section)
      );
      console.error(
        "[Analysis:validateStructure] ✗ Validation failed: Missing sections:",
        missingSections
      );
      context.validationFailed = true;
      context.lastValidationError = "Analysis missing required sections";
    } else {
      console.log(
        "[Analysis:validateStructure] ✓ Validation passed: All required sections present"
      );
    }
  } catch (error) {
    console.error(
      "[Analysis:validateStructure] ✗ Error during validation:",
      error.message
    );
    throw error;
  }
}

export async function integration(context) {
  console.log("[Analysis:integration] Integrating analysis output");
  try {
    const { analysisContent, metadata } = context.output;

    const result = {
      output: {
        analysis: {
          content: analysisContent,
          metadata,
          timestamp: new Date().toISOString(),
        },
      },
    };

    console.log("[Analysis:integration] ✓ Integration completed");
    return result;
  } catch (error) {
    console.error(
      "[Analysis:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
