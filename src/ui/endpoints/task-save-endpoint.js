import path from "node:path";
import { promises as fs } from "node:fs";
import { getConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";

/**
 * Handle task creation requests
 *
 * POST /api/tasks/create
 * Body: { pipelineSlug, filename, taskName, code }
 *
 * Creates a new task file and updates the pipeline's task registry index.js
 */
export async function handleTaskSave(req, res) {
  try {
    const { pipelineSlug, filename, taskName, code } = req.body;

    if (!pipelineSlug) {
      return sendJson(res, 400, { error: "pipelineSlug is required" });
    }
    // Validate filename ends with .js
    if (!filename || !filename.endsWith(".js")) {
      return sendJson(res, 400, { error: "Filename must end with .js" });
    }

    // Validate taskName is kebab-case
    const kebabCaseRegex = /^[a-z][a-z0-9-]*$/;
    if (!taskName || !kebabCaseRegex.test(taskName)) {
      return sendJson(res, 400, { error: "TaskName must be kebab-case" });
    }

    // Get configuration and root directory
    const config = getConfig();
    const rootDir = config.paths.root;

    // Read registry.json to find pipeline's taskRegistryPath
    const registryPath = path.join(rootDir, "pipeline-config", "registry.json");
    const registryData = JSON.parse(await fs.readFile(registryPath, "utf8"));

    // Look up pipeline in registry
    const pipelineEntry = registryData.pipelines[pipelineSlug];
    if (!pipelineEntry) {
      return sendJson(res, 404, { error: "Pipeline not found" });
    }

    // Get task registry path (relative to root)
    const taskRegistryPath = path.join(rootDir, pipelineEntry.taskRegistryPath);
    const tasksDir = path.dirname(taskRegistryPath);

    // Write task file (prevent path traversal by validating resolved path)
    const taskFilePath = path.resolve(tasksDir, filename);
    if (!taskFilePath.startsWith(tasksDir)) {
      return sendJson(res, 400, { error: "Invalid filename" });
    }
    await fs.writeFile(taskFilePath, code, "utf8");

    // Update index.js to export new task
    const indexPath = taskRegistryPath;
    let indexContent = await fs.readFile(indexPath, "utf8");

    // Find the line containing "export default {"
    const exportLine = "export default {";
    const exportLineIndex = indexContent.indexOf(exportLine);

    if (exportLineIndex === -1) {
      return sendJson(res, 500, {
        error: "Failed to find export default line in index.js",
      });
    }

    // Insert new task entry after the export line
    const insertPosition = indexContent.indexOf("\n", exportLineIndex) + 1;
    const newEntry = `  ${taskName}: "./${filename}",\n`;

    indexContent =
      indexContent.slice(0, insertPosition) +
      newEntry +
      indexContent.slice(insertPosition);

    // Write updated index.js
    await fs.writeFile(indexPath, indexContent, "utf8");

    return sendJson(res, 200, {
      ok: true,
      path: taskFilePath,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return sendJson(res, 500, {
      error: error.message || "Failed to create task",
    });
  }
}
