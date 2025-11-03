/**
 * Deterministic progress computation for pipeline tasks.
 * Provides a single authoritative mapping from (pipelineTaskIds, currentTaskId, currentStageName) → progress percentage.
 */

/**
 * Fixed ordered list of all possible stages in a pipeline.
 * The order is canonical and used for deterministic progress calculation.
 */
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
];

/**
 * Computes deterministic progress percentage for a pipeline execution.
 *
 * Progress is calculated based on the position of the current task in the ordered pipeline
 * and the position of the current stage in the fixed stage list. This ensures that
 * identical inputs always produce the same progress value.
 *
 * @param {string[]} pipelineTaskIds - Ordered list of task IDs in the pipeline
 * @param {string} currentTaskId - ID of the currently executing task
 * @param {string} currentStageName - Name of the current stage being executed
 * @param {string[]} [stages=KNOWN_STAGES] - Stage list to use for calculation (defaults to KNOWN_STAGES)
 * @returns {number} Progress percentage as integer in [0, 100]
 *
 * @example
 * computeDeterministicProgress(
 *   ["task-1", "task-2"],
 *   "task-1",
 *   "ingestion"
 * ); // → 5
 */
export function computeDeterministicProgress(
  pipelineTaskIds,
  currentTaskId,
  currentStageName,
  stages = KNOWN_STAGES
) {
  // Guard against empty pipeline to avoid division by zero
  const totalSteps = Math.max(1, pipelineTaskIds.length * stages.length);

  // Find task position, fallback to 0 if not found
  const taskIdx = Math.max(0, pipelineTaskIds.indexOf(currentTaskId));

  // Find stage position, fallback to 0 if not found
  const stageIdx = Math.max(0, stages.indexOf(currentStageName));

  // Completed steps = (completed tasks * stages per task) + (completed stages in current task)
  // We count the current stage as completed since this is called after stage completion
  const completed = taskIdx * stages.length + (stageIdx + 1);

  // Calculate percentage and clamp to [0, 100]
  const percent = Math.round((100 * completed) / totalSteps);
  return Math.max(0, Math.min(100, percent));
}
