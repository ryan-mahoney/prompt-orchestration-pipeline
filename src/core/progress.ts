export const KNOWN_STAGES = [
  "ingestion",
  "preProcessing",
  "promptTemplating",
  "inference",
  "parsing",
  "validateStructure",
  "validateQuality",
  "critique",
  "refine",
  "finalValidation",
  "integration",
] as const;

export type StageName = (typeof KNOWN_STAGES)[number];

export function computeDeterministicProgress(
  pipelineTaskIds: string[],
  currentTaskId: string,
  currentStageName: string,
  stages: readonly string[] = KNOWN_STAGES,
): number {
  const taskCount = pipelineTaskIds.length;
  const stageCount = stages.length;

  const taskIndex = Math.max(0, pipelineTaskIds.indexOf(currentTaskId));
  const stageIndex = Math.max(0, stages.indexOf(currentStageName));

  const totalSteps = taskCount === 0 ? 1 : taskCount * stageCount;
  const completedSteps = taskIndex * stageCount + (stageIndex + 1);

  return Math.min(100, Math.max(0, Math.round((100 * completedSteps) / totalSteps)));
}
