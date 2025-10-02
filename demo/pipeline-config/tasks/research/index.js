// Research Task - Gather information based on seed input

export async function ingestion(context) {
  console.log("[Research:ingestion] Starting data ingestion");
  try {
    const { seed } = context;
    const result = {
      output: {
        topic: seed.data.topic || seed.data.industry,
        focusAreas: seed.data.focusAreas || [],
        requirements: seed.data,
      },
    };
    console.log("[Research:ingestion] ✓ Successfully ingested data:", {
      topic: result.output.topic,
      focusAreasCount: result.output.focusAreas.length,
    });
    return result;
  } catch (error) {
    console.error(
      "[Research:ingestion] ✗ Error during ingestion:",
      error.message
    );
    throw error;
  }
}

export async function promptTemplating(context) {
  console.log("[Research:promptTemplating] Building prompt template");
  try {
    const { topic, focusAreas } = context.output;

    const result = {
      output: {
        ...context.output,
        system:
          "You are a research assistant specializing in comprehensive information gathering.",
        prompt: `Research the following topic: ${topic}

Focus areas:
${focusAreas.map((area) => `- ${area}`).join("\n")}

Provide detailed, factual information with sources where possible.`,
      },
    };
    console.log("[Research:promptTemplating] ✓ Prompt template created");
    return result;
  } catch (error) {
    console.error(
      "[Research:promptTemplating] ✗ Error creating prompt:",
      error.message
    );
    throw error;
  }
}

export async function inference(context) {
  console.log("[Research:inference] Starting LLM inference");
  try {
    const { system, prompt } = context.output;
    const model = context.taskConfig?.model || "gpt-5-nano";

    console.log("[Research:inference] Using model:", model);

    const response = await context.llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      model,
      temperature: context.taskConfig?.temperature || 0.7,
      max_tokens: context.taskConfig?.maxTokens || 2000,
    });

    const result = {
      output: {
        ...context.output,
        researchContent: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
          finishReason: response.finish_reason,
        },
      },
    };

    console.log("[Research:inference] ✓ Inference completed:", {
      model: result.output.metadata.model,
      tokens: result.output.metadata.tokens,
      contentLength: response.content.length,
    });

    return result;
  } catch (error) {
    console.error(
      "[Research:inference] ✗ Error during inference:",
      error.message
    );
    throw error;
  }
}

export async function validateStructure(context) {
  console.log("[Research:validateStructure] Validating research content");
  try {
    const { researchContent } = context.output;

    if (!researchContent || researchContent.length < 100) {
      console.error(
        "[Research:validateStructure] ✗ Validation failed: Content too short or missing"
      );
      context.validationFailed = true;
      context.lastValidationError = "Research content too short or missing";
    } else {
      console.log("[Research:validateStructure] ✓ Validation passed:", {
        contentLength: researchContent.length,
      });
    }
  } catch (error) {
    console.error(
      "[Research:validateStructure] ✗ Error during validation:",
      error.message
    );
    throw error;
  }
}

export async function integration(context) {
  console.log("[Research:integration] Integrating research output");
  try {
    const { researchContent, metadata } = context.output;

    const result = {
      output: {
        research: {
          content: researchContent,
          metadata,
          timestamp: new Date().toISOString(),
        },
      },
    };

    console.log("[Research:integration] ✓ Integration completed");
    return result;
  } catch (error) {
    console.error(
      "[Research:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
