import fs from "node:fs/promises";
import path from "node:path";

/**
 * Updates pipeline.json to include a new task
 * @param {string} root - The pipeline root directory
 * @param {string} pipelineSlug - The pipeline slug
 * @param {string} taskSlug - The task slug to add
 */
export async function updatePipelineJson(root, pipelineSlug, taskSlug) {
  const pipelineConfigPath = path.join(
    root,
    "pipeline-config",
    pipelineSlug,
    "pipeline.json"
  );
  let pipelineConfig = {};

  try {
    const pipelineContent = await fs.readFile(pipelineConfigPath, "utf8");
    pipelineConfig = JSON.parse(pipelineContent);
  } catch (error) {
    // If file is missing or invalid, create minimal config
    pipelineConfig = {
      name: pipelineSlug,
      version: "1.0.0",
      description: "New pipeline",
      tasks: [],
    };
  }

  // Ensure tasks array exists
  if (!Array.isArray(pipelineConfig.tasks)) {
    pipelineConfig.tasks = [];
  }

  // Add task to the end of the list if not already present
  if (!pipelineConfig.tasks.includes(taskSlug)) {
    pipelineConfig.tasks.push(taskSlug);
  }

  // Write back pipeline.json
  await fs.writeFile(
    pipelineConfigPath,
    JSON.stringify(pipelineConfig, null, 2) + "\n"
  );
}
