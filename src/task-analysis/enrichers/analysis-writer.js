import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write task analysis file to the analysis/ directory.
 *
 * @param {string} pipelinePath - Path to pipeline directory
 * @param {string} taskName - Task name (e.g., "research")
 * @param {object} analysisData - Task analysis object containing { taskFilePath, stages, artifacts, models }
 */
export async function writeAnalysisFile(pipelinePath, taskName, analysisData) {
  // Validate that analysisData contains all required properties
  if (!analysisData || typeof analysisData !== "object") {
    throw new Error(
      `Invalid analysisData: expected an object but got ${typeof analysisData}`
    );
  }

  if (
    !analysisData.taskFilePath ||
    typeof analysisData.taskFilePath !== "string"
  ) {
    throw new Error(
      `Invalid analysisData.taskFilePath: expected a string but got ${typeof analysisData.taskFilePath}`
    );
  }

  if (!Array.isArray(analysisData.stages)) {
    throw new Error(
      `Invalid analysisData.stages: expected an array but got ${typeof analysisData.stages}`
    );
  }

  if (
    !analysisData.artifacts ||
    typeof analysisData.artifacts !== "object" ||
    Array.isArray(analysisData.artifacts)
  ) {
    throw new Error(
      `Invalid analysisData.artifacts: expected an object but got ${typeof analysisData.artifacts}`
    );
  }

  if (!Array.isArray(analysisData.models)) {
    throw new Error(
      `Invalid analysisData.models: expected an array but got ${typeof analysisData.models}`
    );
  }

  const analysisDir = path.join(pipelinePath, "analysis");
  await fs.mkdir(analysisDir, { recursive: true });

  const output = {
    ...analysisData,
    analyzedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(analysisDir, `${taskName}.analysis.json`),
    JSON.stringify(output, null, 2)
  );
}
