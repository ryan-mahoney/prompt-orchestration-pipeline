// Task 1: Data Extraction
// Updated to use context.llm interface and implement all 11 pipeline stages

const dataExtraction = {
  async ingestion(context) {
    console.log("📥 [Data Extraction] Starting ingestion...");
    const { seed } = context;

    return {
      rawData: seed.input,
      extractionTargets: seed.requirements?.sections || [
        "companies",
        "market_size",
        "trends",
      ],
    };
  },

  async preProcessing(context) {
    console.log("⚙️ [Data Extraction] Pre-processing...");
    const { rawData, extractionTargets } = context;

    const processedInput = {
      industry: rawData.industry,
      region: rawData.region,
      timeframe: rawData.timeframe,
      targets: extractionTargets,
    };

    return { processedInput };
  },

  async promptTemplating(context) {
    console.log("📝 [Data Extraction] Creating prompt...");
    const { processedInput, refined, critique } = context;

    let prompt = `Extract key data points about the ${processedInput.industry} industry in ${processedInput.region} for ${processedInput.timeframe}.

Focus on extracting:
${processedInput.targets.map((t) => `- ${t}`).join("\n")}

Provide specific numbers, company names, and market metrics where possible.
Format the response as structured data with clear categories.`;

    // Apply refinement if available
    if (refined && critique) {
      prompt += `\n\nPrevious attempt had issues. Improvement guidance:\n${critique}`;
    }

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Data Extraction] Calling LLM...");
    const { prompt } = context;

    // Use context.llm interface provided by task-runner
    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a data extraction assistant. Extract structured market data from the given requirements.",
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
    console.log("🔧 [Data Extraction] Parsing output...");
    const { rawOutput } = context;

    const parsed = {
      extractedData: rawOutput,
      extractionType: "market_data",
      timestamp: new Date().toISOString(),
    };

    return { parsedOutput: parsed };
  },

  async validateStructure(context) {
    console.log("✅ [Data Extraction] Validating structure...");
    const { parsedOutput } = context;

    if (!parsedOutput.extractedData || parsedOutput.extractedData.length < 50) {
      context.validationFailed = true;
      context.lastValidationError = "Extracted data is too short or missing";
      throw new Error(context.lastValidationError);
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Data Extraction] Validating quality...");
    const { modelMetadata } = context;

    if (modelMetadata.confidence < 0.7) {
      context.validationFailed = true;
      context.lastValidationError = `Model confidence too low: ${modelMetadata.confidence}`;
      throw new Error(context.lastValidationError);
    }

    return { qualityValid: true };
  },

  async critique(context) {
    console.log("🔍 [Data Extraction] Generating critique...");

    // Only run if validation failed
    if (!context.validationFailed) {
      return { critique: null };
    }

    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a quality assurance expert. Analyze why the data extraction failed and suggest specific improvements.",
        },
        {
          role: "user",
          content: `The data extraction failed with error: ${context.lastValidationError}\n\nOriginal output: ${context.parsedOutput?.extractedData || "N/A"}\n\nProvide specific guidance on how to improve the extraction.`,
        },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3,
    });

    return { critique: response.content };
  },

  async refine(context) {
    console.log("✨ [Data Extraction] Applying refinements...");

    // Only run if we have critique
    if (!context.critique) {
      return { refined: false };
    }

    // Mark that refinement has been applied
    // The promptTemplating stage will use this to enhance the prompt
    return { refined: true };
  },

  async finalValidation(context) {
    console.log("🎯 [Data Extraction] Final validation...");
    const { parsedOutput, modelMetadata } = context;

    // Comprehensive final check
    const checks = {
      hasData:
        parsedOutput.extractedData && parsedOutput.extractedData.length >= 50,
      hasMetadata: !!modelMetadata,
      hasTimestamp: !!parsedOutput.timestamp,
      confidenceOk: modelMetadata.confidence >= 0.7,
    };

    const allPassed = Object.values(checks).every((v) => v);

    if (!allPassed) {
      throw new Error(`Final validation failed: ${JSON.stringify(checks)}`);
    }

    return { finalValidationPassed: true };
  },

  async integration(context) {
    console.log("📦 [Data Extraction] Finalizing...");
    const { parsedOutput, modelMetadata } = context;

    return {
      output: {
        ...parsedOutput,
        metadata: modelMetadata,
        stage: "data_extraction_complete",
      },
    };
  },
};

export default dataExtraction;
