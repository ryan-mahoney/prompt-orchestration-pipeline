// ── src/task-analysis/enrichers/analysis-writer.ts ──
// Persists TaskAnalysis to disk as JSON.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { TaskAnalysis } from "../types.ts";

function validate(analysisData: TaskAnalysis): void {
  const { taskFilePath, stages, models, artifacts } = analysisData;

  if (taskFilePath === null || taskFilePath === undefined || taskFilePath === "") {
    throw new Error(
      `Invalid taskFilePath: expected a non-null, non-empty string, got ${taskFilePath === "" ? "empty string" : String(taskFilePath)}`,
    );
  }

  if (!Array.isArray(stages)) {
    throw new Error(
      `Invalid stages: expected an array, got ${typeof stages}`,
    );
  }

  if (!Array.isArray(models)) {
    throw new Error(
      `Invalid models: expected an array, got ${typeof models}`,
    );
  }

  if (
    typeof artifacts !== "object" ||
    artifacts === null ||
    !Array.isArray(artifacts.reads) ||
    !Array.isArray(artifacts.writes)
  ) {
    throw new Error(
      `Invalid artifacts: expected an object with reads and writes arrays`,
    );
  }

  if (
    "unresolvedReads" in artifacts &&
    !Array.isArray(artifacts.unresolvedReads)
  ) {
    throw new Error(
      `Invalid artifacts.unresolvedReads: expected an array, got ${typeof artifacts.unresolvedReads}`,
    );
  }

  if (
    "unresolvedWrites" in artifacts &&
    !Array.isArray(artifacts.unresolvedWrites)
  ) {
    throw new Error(
      `Invalid artifacts.unresolvedWrites: expected an array, got ${typeof artifacts.unresolvedWrites}`,
    );
  }
}

export async function writeAnalysisFile(
  pipelinePath: string,
  taskName: string,
  analysisData: TaskAnalysis,
): Promise<void> {
  validate(analysisData);

  const analysisDir = path.join(pipelinePath, "analysis");
  await mkdir(analysisDir, { recursive: true });

  const data = { ...analysisData, analyzedAt: new Date().toISOString() };

  await Bun.write(
    path.join(analysisDir, `${taskName}.analysis.json`),
    JSON.stringify(data, null, 2),
  );
}
