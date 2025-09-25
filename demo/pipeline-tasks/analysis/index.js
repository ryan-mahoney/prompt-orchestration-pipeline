import { callChatGPT, MockChatGPT } from "../../mock-chatgpt.js";

const analysis = {
  async ingestion(context) {
    console.log("📥 [Analysis] Starting ingestion...");
    const { artifacts } = context;

    const extractedData =
      artifacts["data-extraction"]?.extractedData ||
      "No previous data available";

    return {
      inputData: extractedData,
      analysisType: "market_analysis",
    };
  },

  async promptTemplating(context) {
    console.log("📝 [Analysis] Creating analysis prompt...");
    const { inputData, seed } = context;

    const prompt = `Analyze the following market data for ${seed.input.industry} in ${seed.input.region}:

DATA:
${inputData}

Provide a comprehensive analysis including:
1. Market trends and drivers
2. Competitive landscape assessment  
3. Growth opportunities
4. Key challenges and risks
5. Strategic recommendations

Focus on actionable insights and quantify impacts where possible.`;

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Analysis] Generating analysis...");
    const { prompt } = context;

    const model = MockChatGPT.selectBestModel("analysis", "high");
    const response = await callChatGPT(prompt, model);

    return {
      rawOutput: response.choices[0].message.content,
      modelMetadata: {
        model: response.model,
        tokens: response.usage.total_tokens,
        confidence: response.metadata.confidence,
      },
    };
  },

  async parsing(context) {
    console.log("🔧 [Analysis] Parsing analysis...");
    const { rawOutput } = context;

    const parsed = {
      analysisContent: rawOutput,
      analysisType: "comprehensive_market_analysis",
      generatedAt: new Date().toISOString(),
    };

    return { parsedOutput: parsed };
  },

  async validateStructure(context) {
    console.log("✅ [Analysis] Validating analysis structure...");
    const { parsedOutput } = context;

    const content = parsedOutput.analysisContent.toLowerCase();
    const requiredSections = [
      "trend",
      "competitive",
      "opportunit",
      "challenge",
    ];

    const missingSections = requiredSections.filter(
      (section) => !content.includes(section)
    );

    if (missingSections.length > 1) {
      throw new Error(
        `Analysis missing key sections: ${missingSections.join(", ")}`
      );
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Analysis] Validating analysis quality...");
    const { parsedOutput, modelMetadata } = context;

    if (parsedOutput.analysisContent.length < 200) {
      context.validationFailed = true;
      throw new Error("Analysis too brief for comprehensive assessment");
    }

    if (modelMetadata.confidence < 0.75) {
      context.validationFailed = true;
      throw new Error(
        `Analysis confidence too low: ${modelMetadata.confidence}`
      );
    }

    return { qualityValid: true };
  },

  async integration(context) {
    console.log("📦 [Analysis] Finalizing analysis...");
    const { parsedOutput, modelMetadata } = context;

    return {
      output: {
        ...parsedOutput,
        metadata: modelMetadata,
        stage: "analysis_complete",
      },
    };
  },

  async critique(context) {
    console.log("🔍 [Analysis] Generating critique...");
    const { lastValidationError, parsedOutput } = context;

    if (!lastValidationError) {
      return { critiqueFeedback: null };
    }

    // Generate feedback based on what failed
    const feedback = {
      error: lastValidationError.message,
      suggestions: [],
      refinementStrategy: "enhance",
    };

    if (lastValidationError.message.includes("missing key sections")) {
      feedback.suggestions.push("Ensure all required sections are covered");
      feedback.suggestions.push(
        "Add more detail to competitive and opportunity analysis"
      );
      feedback.refinementStrategy = "expand";
    }

    if (lastValidationError.message.includes("too brief")) {
      feedback.suggestions.push("Provide more detailed analysis");
      feedback.suggestions.push(
        "Include quantitative data and specific examples"
      );
      feedback.refinementStrategy = "elaborate";
    }

    if (lastValidationError.message.includes("confidence too low")) {
      feedback.suggestions.push("Use more authoritative sources");
      feedback.suggestions.push("Provide clearer conclusions");
      feedback.refinementStrategy = "strengthen";
    }

    return { critiqueFeedback: feedback };
  },

  async refine(context) {
    console.log("🔄 [Analysis] Refining analysis based on feedback...");
    const { critiqueFeedback, prompt, parsedOutput } = context;

    if (!critiqueFeedback) {
      return {};
    }

    // Enhance the prompt based on critique feedback
    let refinedPrompt = prompt;

    if (critiqueFeedback.refinementStrategy === "expand") {
      refinedPrompt = `${prompt}\n\nIMPORTANT: Ensure you cover ALL sections comprehensively:
- Market trends and drivers (with specific data points)
- Competitive landscape (name key competitors)
- Growth opportunities (quantify where possible)
- Challenges and risks (be specific)
- Strategic recommendations (actionable steps)`;
    } else if (critiqueFeedback.refinementStrategy === "elaborate") {
      refinedPrompt = `${prompt}\n\nProvide a DETAILED analysis of at least 500 words with specific examples, data points, and actionable insights for each section.`;
    } else if (critiqueFeedback.refinementStrategy === "strengthen") {
      refinedPrompt = `${prompt}\n\nBe authoritative and specific in your analysis. Use concrete data, cite industry standards, and provide clear, confident recommendations.`;
    }

    // Add feedback as context
    if (critiqueFeedback.suggestions.length > 0) {
      refinedPrompt += `\n\nAddress these points: ${critiqueFeedback.suggestions.join(", ")}`;
    }

    return {
      prompt: refinedPrompt,
      isRefinement: true,
      refinementFeedback: critiqueFeedback,
    };
  },

  async finalValidation(context) {
    console.log("✨ [Analysis] Final validation after refinement...");
    const { parsedOutput, isRefinement, modelMetadata } = context;

    // If this is after refinement, be slightly more lenient
    const minLength = isRefinement ? 180 : 200;
    const minConfidence = isRefinement ? 0.7 : 0.75;

    if (parsedOutput.analysisContent.length < minLength) {
      throw new Error(
        `Final validation failed: Analysis still too brief (${parsedOutput.analysisContent.length} chars)`
      );
    }

    if (modelMetadata.confidence < minConfidence) {
      throw new Error(
        `Final validation failed: Confidence still too low (${modelMetadata.confidence})`
      );
    }

    return { finalValidationPassed: true };
  },
};

export default analysis;
