// Task registry for content generation pipeline
export default {
  ingestion: () => import("./ingestion.js"),
  analysis: () => import("./analysis.js"),
  integration: () => import("./integration.js"),
};
