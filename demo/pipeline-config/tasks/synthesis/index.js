// Synthesis Task - Combine research and analysis into coherent output

export async function ingestion(context) {
  console.log("[Synthesis:ingestion] Starting data ingestion");
  try {
    const { artifacts } = context;

    const result = {
      output: {
        research: artifacts?.research?.research?.content,
        analysis: artifacts?.analysis?.analysis?.content,
        outputFormat: context.seed.data.outputFormat,
      },
    };

    console.log("[Synthesis:ingestion] ✓ Successfully ingested data:", {
      hasResearch: !!result.output.research,
      hasAnalysis: !!result.output.analysis,
      outputFormat: result.output.outputFormat,
    });

    return result;
  } catch (error) {
    console.error(
      "[Synthesis:ingestion] ✗ Error during ingestion:",
      error.message
    );
    throw error;
  }
}

export async function promptTemplating(context) {
  console.log("[Synthesis:promptTemplating] Building prompt template");
  try {
    const { research, analysis, outputFormat } = context.output;

    const result = {
      output: {
        ...context.output,
        system:
          "You are a skilled writer who synthesizes complex information into clear, actionable content.",
        prompt: `Synthesize the following research and analysis into a cohesive ${outputFormat}:

RESEARCH:
${research}

ANALYSIS:
${analysis}

Create a well-structured, comprehensive output that combines these insights.`,
      },
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
    const { system, prompt } = context.output;
    const model = context.taskConfig?.model || "gpt-5-nano";

    console.log("[Synthesis:inference] Using model:", model);

    const response = await context.llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      model,
      temperature: context.taskConfig?.temperature || 0.8,
      max_tokens: context.taskConfig?.maxTokens || 3000,
    });

    const result = {
      output: {
        ...context.output,
        synthesizedContent: response.content,
        metadata: {
          model: response.model,
          tokens: response.usage?.total_tokens,
        },
      },
    };

    console.log("[Synthesis:inference] ✓ Inference completed:", {
      model: result.output.metadata.model,
      tokens: result.output.metadata.tokens,
      contentLength: response.content.length,
    });

    return result;
  } catch (error) {
    console.error(
      "[Synthesis:inference] ✗ Error during inference:",
      error.message
    );
    throw error;
  }
}

// Validation removed - synthesis output is acceptable as-is

export async function integration(context) {
  console.log("[Synthesis:integration] Integrating synthesis output");
  try {
    const { synthesizedContent, metadata } = context.output;

    const result = {
      output: {
        synthesis: {
          content: synthesizedContent,
          wordCount: synthesizedContent.split(/\s+/).length,
          metadata,
          timestamp: new Date().toISOString(),
        },
      },
    };

    console.log("[Synthesis:integration] ✓ Integration completed:", {
      wordCount: result.output.synthesis.wordCount,
    });

    return result;
  } catch (error) {
    console.error(
      "[Synthesis:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
