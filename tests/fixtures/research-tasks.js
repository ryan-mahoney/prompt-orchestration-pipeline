// Research tasks for testing context.data.seed access
export const ingestion = async (context) => {
  // Research task should access seed from context.data
  const { data = {} } = context;
  const { seed = {} } = data;
  const { data: seedData = {} } = seed;

  expect(seedData.topic).toBeDefined();

  return {
    output: {
      topic: seedData.topic || "Unknown topic",
      focusAreas: seedData.focusAreas || [],
      requirements: seedData,
    },
    flags: {},
  };
};

export const validateStructure = async (context) => {
  // Should have output from ingestion
  expect(context.output).toBeDefined();
  expect(context.output.topic).toBe("AI Research");

  return {
    output: { validationPassed: true },
    flags: { validationFailed: false },
  };
};

export default {
  ingestion,
  validateStructure,
};
