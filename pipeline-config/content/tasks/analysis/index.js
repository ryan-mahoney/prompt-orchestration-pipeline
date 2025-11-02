// Analysis Task - Analyze research findings and extract insights

export async function ingestion(context) {
  console.log("[Analysis:ingestion] Starting data ingestion");
  try {
    // Read from context.data instead of direct context properties
    const { data = {} } = context;
    const { seed = {}, research: researchStage = {} } = data;
    const { type: analysisType = "unknown" } = seed.data || {};
    const research = researchStage.research?.research;

    if (!research) {
      console.error(
        "[Analysis:ingestion] ✗ Research data not found in context.data"
      );
      throw new Error("Research data not found in context.data");
    }

    // Use new file I/O API to log ingestion process
    if (context.files) {
      await context.files.writeLog(
        "ingestion.log",
        `[${new Date().toISOString()}] Starting data ingestion for ${analysisType}\n`
      );
      await context.files.writeLog(
        "ingestion.log",
        `Research content length: ${research.content.length} characters\n`
      );
    }

    const result = {
      output: {
        researchContent: research.content,
        analysisType,
      },
      flags: {},
    };

    // Write raw research data as artifact for reference
    if (context.files) {
      await context.files.writeArtifact(
        "raw-research.json",
        JSON.stringify(
          {
            content: research.content,
            type: analysisType,
            ingestedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      await context.files.writeLog(
        "ingestion.log",
        `[${new Date().toISOString()}] ✓ Successfully ingested data\n`
      );
    }

    console.log("[Analysis:ingestion] ✓ Successfully ingested data:", {
      researchContentLength: research.content.length,
      analysisType,
    });

    return result;
  } catch (error) {
    if (context.files) {
      await context.files.writeLog(
        "ingestion.log",
        `[${new Date().toISOString()}] ✗ Error during ingestion: ${error.message}\n`
      );
    }
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
      flags: {},
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
    const pt = context.data?.promptTemplating;
    if (!pt?.system || !pt?.prompt) {
      throw new Error(
        "promptTemplating output missing required fields: system/prompt"
      );
    }
    const { system, prompt } = pt;
    const model = context.taskConfig?.model || "gpt-5-nano";

    console.log("[Analysis:inference] Using model:", model);

    const response = await context.llm.deepseek.chat({
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
      flags: {},
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

    let validationFailed = false;
    let lastValidationError = undefined;

    if (!hasAllSections) {
      const missingSections = requiredSections.filter(
        (section) => !analysisContent.toLowerCase().includes(section)
      );
      console.error(
        "[Analysis:validateStructure] ✗ Validation failed: Missing sections:",
        missingSections
      );
      validationFailed = true;
      lastValidationError = `Analysis missing required sections: ${missingSections.join(", ")}`;
    } else {
      console.log(
        "[Analysis:validateStructure] ✓ Validation passed: All required sections present"
      );
    }

    return {
      output: {
        validationResult: {
          contentLength: analysisContent?.length || 0,
          passed: !validationFailed,
          missingSections: validationFailed
            ? requiredSections.filter(
                (section) => !analysisContent.toLowerCase().includes(section)
              )
            : [],
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
      "[Analysis:validateStructure] ✗ Error during validation:",
      error.message
    );
    throw error;
  }
}

export async function critique(context) {
  console.log("[Analysis:critique] Analyzing analysis content for improvement");
  try {
    const { analysisContent } = context.output;
    const validationError = context.flags.lastValidationError;

    let critiqueComplete = true;
    let critiqueResult = {
      hasContent: !!analysisContent,
      contentLength: analysisContent?.length || 0,
      hasValidationError: !!validationError,
      critique: validationError
        ? `Analysis needs improvement due to validation error: ${validationError}`
        : "Analysis appears adequate with all required sections present",
    };

    console.log("[Analysis:critique] ✓ Critique completed:", {
      contentLength: critiqueResult.contentLength,
      hasValidationError: critiqueResult.hasValidationError,
    });

    return {
      output: {
        critiqueResult,
      },
      flags: {
        critiqueComplete,
      },
    };
  } catch (error) {
    console.error(
      "[Analysis:critique] ✗ Error during critique:",
      error.message
    );
    throw error;
  }
}

export async function refine(context) {
  console.log("[Analysis:refine] Refining analysis content based on feedback");
  try {
    const { analysisContent } = context.output;
    const validationFailed = context.flags.validationFailed;
    const validationError = context.flags.lastValidationError;

    let refined = false;
    let refinedContent = analysisContent;

    if (validationFailed && validationError) {
      console.log(
        "[Analysis:refine] Attempting to refine content due to validation error"
      );

      // For demo purposes, we'll add missing sections
      // In a real implementation, this would use LLM to improve the content
      const missingSections = validationError.includes("findings")
        ? "1. Key findings: [Added based on research]\n\n"
        : "";
      const trendsSection = validationError.includes("trends")
        ? "2. Trends and patterns: [Identified from data]\n\n"
        : "";
      const recommendationsSection = validationError.includes("recommendations")
        ? "3. Recommendations: [Proposed actions]\n\n"
        : "";

      refinedContent = `${missingSections}${trendsSection}${recommendationsSection}${analysisContent}\n\n[Note: Analysis has been refined to address validation issues.]`;
      refined = true;

      console.log("[Analysis:refine] ✓ Content refined with missing sections");
    } else {
      console.log("[Analysis:refine] No refinement needed");
    }

    return {
      output: {
        ...context.output,
        analysisContent: refinedContent,
        refineResult: {
          originalLength: analysisContent?.length || 0,
          refinedLength: refinedContent?.length || 0,
          refined,
          refinedAt: new Date().toISOString(),
        },
      },
      flags: {
        refined,
      },
    };
  } catch (error) {
    console.error(
      "[Analysis:refine] ✗ Error during refinement:",
      error.message
    );
    throw error;
  }
}

export async function integration(context) {
  console.log("[Analysis:integration] Integrating analysis output");
  try {
    const { analysisContent, metadata } = context.output;

    // Write final analysis as artifact using new file I/O API
    if (context.files) {
      await context.files.writeArtifact(
        "analysis-output.json",
        JSON.stringify(
          {
            content: analysisContent,
            metadata,
            timestamp: new Date().toISOString(),
            taskName: context.taskName,
            analysisType: context.output.analysisType,
          },
          null,
          2
        )
      );

      // Write a summary file for quick reference
      await context.files.writeArtifact(
        "analysis-summary.txt",
        `Analysis Summary
Type: ${context.output.analysisType}
Generated: ${new Date().toISOString()}
Model: ${metadata.model}
Tokens: ${metadata.tokens}

Content Preview:
${analysisContent.substring(0, 500)}${
          analysisContent.length > 500 ? "..." : ""
        }`
      );

      // Log integration completion
      await context.files.writeLog(
        "integration.log",
        `[${new Date().toISOString()}] ✓ Analysis integration completed\n`
      );
      await context.files.writeLog(
        "integration.log",
        `Output files: analysis-output.json, analysis-summary.txt\n`
      );
    }

    const result = {
      output: {
        analysis: {
          content: analysisContent,
          metadata,
          timestamp: new Date().toISOString(),
        },
      },
      flags: {},
    };

    console.log("[Analysis:integration] ✓ Integration completed");
    return result;
  } catch (error) {
    if (context.files) {
      await context.files.writeLog(
        "integration.log",
        `[${new Date().toISOString()}] ✗ Error during integration: ${error.message}\n`
      );
    }
    console.error(
      "[Analysis:integration] ✗ Error during integration:",
      error.message
    );
    throw error;
  }
}
