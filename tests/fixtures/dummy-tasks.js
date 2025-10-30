// Dummy module for task-runner tests
export const ingestion = async (context) => ({
  output: { ingested: true, data: context.output },
  flags: { ingestionComplete: true },
});

export const preProcessing = async (context) => ({
  output: { preProcessed: true, data: context.output },
  flags: { preProcessingComplete: true },
});

export const promptTemplating = async (context) => ({
  output: { template: "test-template", data: context.output },
  flags: { templateReady: true },
});

export const inference = async (context) => ({
  output: { result: "test-inference", data: context.output },
  flags: { inferenceComplete: true },
});

export const parsing = async (context) => ({
  output: { parsed: true, data: context.output },
  flags: { parsingComplete: true },
});

export const validateStructure = async (context) => ({
  output: { validationPassed: true, data: context.output },
  flags: { validationFailed: false },
});

export const validateQuality = async (context) => ({
  output: { qualityValid: true, data: context.output },
  flags: { qualityValidationPassed: true },
});

export const critique = async (context) => ({
  output: { critique: "good", data: context.output },
  flags: { critiqueComplete: true },
});

export const refine = async (context) => ({
  output: { refined: true, data: context.output },
  flags: { refined: true },
});

export const finalValidation = async (context) => ({
  output: { finalResult: true, data: context.output },
  flags: { finalValidationPassed: true },
});

export const integration = async (context) => ({
  output: { integrated: true, data: context.output },
  flags: { integrationComplete: true },
});

export default {
  ingestion,
  preProcessing,
  promptTemplating,
  inference,
  parsing,
  validateStructure,
  validateQuality,
  critique,
  refine,
  finalValidation,
  integration,
};
