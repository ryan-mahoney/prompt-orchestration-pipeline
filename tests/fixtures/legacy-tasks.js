// Legacy-style tasks for testing legacy stage chaining
export const ingestion = async (context) => {
  // Legacy stage - should read from context.data.seed
  expect(context.data.seed).toBeDefined();
  expect(context.data.seed.data).toEqual({ test: "data" });
  return { output: "ingested", flags: {} };
};

export const promptTemplating = async (context) => {
  // Should have context.output populated from previous stage (ingestion)
  expect(context.output).toBe("ingested");
  return { output: "templated", flags: {} };
};

export const inference = async (context) => {
  // Should have context.output populated from previous stage (promptTemplating)
  expect(context.output).toBe("templated");
  return { output: "inferred", flags: {} };
};

export default {
  ingestion,
  promptTemplating,
  inference,
};
