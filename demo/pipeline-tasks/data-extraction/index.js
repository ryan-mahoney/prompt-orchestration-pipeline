import { callChatGPT, MockChatGPT } from "../../mock-chatgpt.js";

// Task 1: Data Extraction
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
    const { processedInput } = context;

    const prompt = `Extract key data points about the ${processedInput.industry} industry in ${processedInput.region} for ${processedInput.timeframe}.

Focus on extracting:
${processedInput.targets.map((t) => `- ${t}`).join("\n")}

Provide specific numbers, company names, and market metrics where possible.
Format the response as structured data with clear categories.`;

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Data Extraction] Calling ChatGPT...");
    const { prompt } = context;

    const model = MockChatGPT.selectBestModel("extraction", "medium");
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
      throw new Error("Extracted data is too short or missing");
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Data Extraction] Validating quality...");
    const { modelMetadata } = context;

    if (modelMetadata.confidence < 0.7) {
      context.validationFailed = true;
      throw new Error(`Model confidence too low: ${modelMetadata.confidence}`);
    }

    return { qualityValid: true };
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
