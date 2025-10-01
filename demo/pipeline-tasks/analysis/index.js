// Task 2: Analysis
// Updated to use context.llm interface and implement all 11 pipeline stages

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

  async preProcessing(context) {
    console.log("⚙️ [Analysis] Pre-processing...");
    const { inputData } = context;

    // Prepare data for analysis
    return {
      processedData: inputData,
      dataReady: true,
    };
  },

  async promptTemplating(context) {
    console.log("📝 [Analysis] Creating analysis prompt...");
    const { inputData, seed, refined, critique } = context;

    let prompt = `Analyze the following market data for ${seed.input.industry} in ${seed.input.region}:

DATA:
${inputData}

Provide a comprehensive analysis including:
1. Market trends and drivers
2. Competitive landscape assessment  
3. Growth opportunities
4. Key challenges and risks
5. Strategic recommendations

Focus on actionable insights and quantify impacts where possible.`;

    // Apply refinement if available
    if (refined && critique) {
      prompt += `\n\nPrevious attempt had issues. Improvement guidance:\n${critique}`;
    }

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Analysis] Generating analysis...");
    const { prompt } = context;

    // Use context.llm interface provided by task-runner
    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a market analysis expert. Provide comprehensive, actionable insights based on the data provided.",
        },
        { role: "user", content: prompt },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.7,
    });

    return {
      rawOutput: response.content,
      modelMetadata: {
        model: response.model || "gpt-3.5-turbo",
        tokens: response.usage?.totalTokens || 0,
        cost: response.cost || 0,
        confidence: 0.85, // Mock confidence for demo
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

    // Only run if validation failed
    if (!context.validationFailed) {
      return { critique: null };
    }

    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a quality assurance expert. Analyze why the analysis failed and suggest specific improvements.",
        },
        {
          role: "user",
          content: `The analysis failed with error: ${context.lastValidationError}\n\nOriginal output: ${context.parsedOutput?.analysisContent?.substring(0, 200) || "N/A"}...\n\nProvide specific guidance on how to improve the analysis.`,
        },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3,
    });

    return { critique: response.content };
  },

  async refine(context) {
    console.log("✨ [Analysis] Applying refinements...");

    // Only run if we have critique
    if (!context.critique) {
      return { refined: false };
    }

    // Mark that refinement has been applied
    // The promptTemplating stage will use this to enhance the prompt
    return { refined: true };
  },

  async finalValidation(context) {
    console.log("🎯 [Analysis] Final validation...");
    const { parsedOutput, modelMetadata } = context;

    // Comprehensive final check
    const checks = {
      hasContent:
        parsedOutput.analysisContent &&
        parsedOutput.analysisContent.length >= 200,
      hasMetadata: !!modelMetadata,
      hasTimestamp: !!parsedOutput.generatedAt,
      confidenceOk: modelMetadata.confidence >= 0.75,
    };

    const allPassed = Object.values(checks).every((v) => v);

    if (!allPassed) {
      throw new Error(`Final validation failed: ${JSON.stringify(checks)}`);
    }

    return { finalValidationPassed: true };
  },
};

export default analysis;
