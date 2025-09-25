import { callChatGPT, MockChatGPT } from "./../../mock-chatgpt.js";

const reportGeneration = {
  async ingestion(context) {
    console.log("📥 [Report] Starting ingestion...");
    const { artifacts, seed } = context;

    const extractedData = artifacts["data-extraction"]?.extractedData || "";
    const analysisData = artifacts["analysis"]?.analysisContent || "";

    return {
      extractedData,
      analysisData,
      reportRequirements: seed.requirements,
    };
  },

  async promptTemplating(context) {
    console.log("📝 [Report] Creating report prompt...");
    const { extractedData, analysisData, reportRequirements } = context;

    const prompt = `Create a professional executive report based on the following research:

EXTRACTED DATA:
${extractedData}

ANALYSIS:
${analysisData}

REQUIREMENTS:
- Format: ${reportRequirements.outputFormat}
- Max length: ${reportRequirements.maxLength} words
- Sections: ${reportRequirements.sections?.join(", ")}

Generate a well-structured executive report with:
1. Executive Summary
2. Key Findings  
3. Market Insights
4. Strategic Recommendations
5. Conclusion

Use professional business language and include specific data points where available.`;

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Report] Generating report...");
    const { prompt } = context;

    const model = MockChatGPT.selectBestModel("report", "high");
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
    console.log("🔧 [Report] Parsing report...");
    const { rawOutput, reportRequirements } = context;

    const wordCount = rawOutput.split(/\s+/).length;

    const parsed = {
      reportContent: rawOutput,
      reportType: reportRequirements.outputFormat,
      wordCount,
      generatedAt: new Date().toISOString(),
    };

    return { parsedOutput: parsed };
  },

  async validateStructure(context) {
    console.log("✅ [Report] Validating report structure...");
    const { parsedOutput } = context;

    const content = parsedOutput.reportContent.toLowerCase();
    const requiredSections = [
      "executive summary",
      "findings",
      "recommendations",
    ];

    const missingSections = requiredSections.filter(
      (section) => !content.includes(section.toLowerCase())
    );

    if (missingSections.length > 0) {
      // Add this line to enable refinement loop
      context.validationFailed = true;
      throw new Error(`Report missing sections: ${missingSections.join(", ")}`);
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Report] Validating report quality...");
    const { parsedOutput, reportRequirements, modelMetadata } = context;

    const maxWords = reportRequirements.maxLength || 5000;
    if (parsedOutput.wordCount > maxWords) {
      context.validationFailed = true;
      throw new Error(
        `Report too long: ${parsedOutput.wordCount} words (max: ${maxWords})`
      );
    }

    if (parsedOutput.wordCount < 500) {
      context.validationFailed = true;
      throw new Error("Report too short for executive level");
    }

    if (modelMetadata.confidence < 0.8) {
      context.validationFailed = true;
      throw new Error(
        `Report quality confidence too low: ${modelMetadata.confidence}`
      );
    }

    return { qualityValid: true };
  },

  async critique(context) {
    console.log("💭 [Report] Generating critique...");
    if (context.lastValidationError) {
      return {
        critiqueHints: {
          error: context.lastValidationError.message,
          suggestions: [
            "Adjust report length to meet requirements",
            "Add more specific data and metrics",
            "Improve section structure and headings",
            "Enhance executive summary clarity",
          ],
        },
      };
    }
    return {};
  },

  async refine(context) {
    console.log("🔄 [Report] Refining report...");
    if (context.critiqueHints) {
      const refinementPrompt = `${context.prompt}

REFINEMENT NEEDED: ${context.critiqueHints.error}
Please address: ${context.critiqueHints.suggestions.join(", ")}

Improve the report to meet these requirements while maintaining professional quality.`;

      return { prompt: refinementPrompt };
    }
    return {};
  },

  async integration(context) {
    console.log("📦 [Report] Finalizing report...");
    const { parsedOutput, modelMetadata } = context;

    return {
      output: {
        ...parsedOutput,
        metadata: {
          ...modelMetadata,
          stage: "report_complete",
          refinementAttempts: context.refinementAttempts || 0,
        },
      },
    };
  },
};

export default reportGeneration;
