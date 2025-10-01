// Task 3: Report Generation
// Updated to use context.llm interface and implement all 11 pipeline stages

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

  async preProcessing(context) {
    console.log("⚙️ [Report] Pre-processing...");
    const { extractedData, analysisData } = context;

    // Prepare combined data for report generation
    return {
      combinedData: {
        extraction: extractedData,
        analysis: analysisData,
      },
      dataReady: true,
    };
  },

  async promptTemplating(context) {
    console.log("📝 [Report] Creating report prompt...");
    const {
      extractedData,
      analysisData,
      reportRequirements,
      refined,
      critique,
    } = context;

    let prompt = `Create a professional executive report based on the following research:

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

    // Apply refinement if available
    if (refined && critique) {
      prompt += `\n\nPrevious attempt had issues. Improvement guidance:\n${critique}`;
    }

    return { prompt };
  },

  async inference(context) {
    console.log("🤖 [Report] Generating report...");
    const { prompt } = context;

    // Use context.llm interface provided by task-runner
    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a professional business report writer. Create clear, concise, and actionable executive reports.",
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
      context.validationFailed = true;
      context.lastValidationError = `Report missing sections: ${missingSections.join(", ")}`;
      throw new Error(context.lastValidationError);
    }

    return { structureValid: true };
  },

  async validateQuality(context) {
    console.log("🎯 [Report] Validating report quality...");
    const { parsedOutput, reportRequirements, modelMetadata } = context;

    const maxWords = reportRequirements.maxLength || 5000;
    if (parsedOutput.wordCount > maxWords) {
      context.validationFailed = true;
      context.lastValidationError = `Report too long: ${parsedOutput.wordCount} words (max: ${maxWords})`;
      throw new Error(context.lastValidationError);
    }

    if (parsedOutput.wordCount < 500) {
      context.validationFailed = true;
      context.lastValidationError = "Report too short for executive level";
      throw new Error(context.lastValidationError);
    }

    if (modelMetadata.confidence < 0.8) {
      context.validationFailed = true;
      context.lastValidationError = `Report quality confidence too low: ${modelMetadata.confidence}`;
      throw new Error(context.lastValidationError);
    }

    return { qualityValid: true };
  },

  async critique(context) {
    console.log("🔍 [Report] Generating critique...");

    // Only run if validation failed
    if (!context.validationFailed) {
      return { critique: null };
    }

    const response = await context.llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a quality assurance expert. Analyze why the report generation failed and suggest specific improvements.",
        },
        {
          role: "user",
          content: `The report generation failed with error: ${context.lastValidationError}\n\nOriginal output: ${context.parsedOutput?.reportContent?.substring(0, 200) || "N/A"}...\n\nProvide specific guidance on how to improve the report.`,
        },
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3,
    });

    return { critique: response.content };
  },

  async refine(context) {
    console.log("✨ [Report] Applying refinements...");

    // Only run if we have critique
    if (!context.critique) {
      return { refined: false };
    }

    // Mark that refinement has been applied
    // The promptTemplating stage will use this to enhance the prompt
    return { refined: true };
  },

  async finalValidation(context) {
    console.log("🎯 [Report] Final validation...");
    const { parsedOutput, modelMetadata, reportRequirements } = context;

    const maxWords = reportRequirements.maxLength || 5000;

    // Comprehensive final check
    const checks = {
      hasContent:
        parsedOutput.reportContent && parsedOutput.reportContent.length >= 500,
      hasMetadata: !!modelMetadata,
      hasTimestamp: !!parsedOutput.generatedAt,
      wordCountOk:
        parsedOutput.wordCount >= 500 && parsedOutput.wordCount <= maxWords,
      confidenceOk: modelMetadata.confidence >= 0.8,
    };

    const allPassed = Object.values(checks).every((v) => v);

    if (!allPassed) {
      throw new Error(`Final validation failed: ${JSON.stringify(checks)}`);
    }

    return { finalValidationPassed: true };
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
        },
      },
    };
  },
};

export default reportGeneration;
