// New-style tasks for testing content pipeline integration
export const validateStructure = async (context) => {
  // Should read from context.data.seed
  expect(context.data.seed).toBeDefined();
  expect(context.data.data).toBeDefined();

  return {
    output: { validationPassed: true, details: "All good" },
    flags: { validationFailed: false, timestamp: Date.now() },
  };
};

export const ingestion = async (context) => {
  // Should read from context.data.seed
  expect(context.data.seed).toBeDefined();

  return {
    output: {
      topic: "Research Topic",
      content: "Ingested content",
      source: context.data.seed.data?.source || "unknown",
    },
    flags: { ingestionComplete: true },
  };
};

export const promptTemplating = async (context) => {
  // Should have context.output from previous stage
  expect(context.output).toBeDefined();
  expect(context.output.topic).toBe("Research Topic");

  return {
    output: {
      ...context.output,
      system: "You are a helpful assistant",
      prompt: `Analyze: ${context.output.topic}`,
    },
    flags: { templateReady: true },
  };
};

export const inference = async (context) => {
  // Should have context.output from promptTemplating
  expect(context.output).toBeDefined();
  expect(context.output.prompt).toContain("Research Topic");

  return {
    output: {
      ...context.output,
      response: "Analysis complete",
      model: "test-model",
    },
    flags: { inferenceComplete: true },
  };
};

export const integration = async (context) => {
  // Should have context.output from inference
  expect(context.output).toBeDefined();
  expect(context.output.response).toBe("Analysis complete");

  return {
    output: {
      finalResult: context.output.response,
      metadata: {
        model: context.output.model,
        topic: context.output.topic,
      },
    },
    flags: { integrationComplete: true },
  };
};

export default {
  validateStructure,
  ingestion,
  promptTemplating,
  inference,
  integration,
};
