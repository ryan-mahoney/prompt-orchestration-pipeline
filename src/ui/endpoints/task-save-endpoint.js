import path from "node:path";
import { promises as fs } from "node:fs";
import { getConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import { reviewAndCorrectTask } from "../lib/task-reviewer.js";

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

    // Self-correct code before saving
    let finalCode = code;
    try {
      const guidelinesPath = path.join(
        rootDir,
        "docs/pipeline-task-guidelines.md"
      );
      const guidelines = await fs.readFile(guidelinesPath, "utf8");
      finalCode = await reviewAndCorrectTask(code, guidelines);
    } catch (reviewError) {
      console.warn(
        "Task review failed, using original code:",
        reviewError.message
      );
    }

    await fs.writeFile(taskFilePath, finalCode, "utf8");

    // Update index.js to export new task
    const indexPath = taskRegistryPath;
    let indexContent = await fs.readFile(indexPath, "utf8");

    // Check if task name already exists in the index (handles both quoted and unquoted)
    const taskNamePattern = new RegExp(`^\\s*"?${taskName}"?\\s*:`, "m");
    if (taskNamePattern.test(indexContent)) {
      return sendJson(res, 400, {
        error: `Task "${taskName}" already exists in the registry`,
      });
    }

    // Detect module format: ESM (export default {) or CommonJS (module.exports = {)
    const esmPattern = /export\s+default\s+\{/;
    const cjsPattern = /module\.exports\s*=\s*\{/;
    const cjsTasksPattern = /module\.exports\s*=\s*\{\s*tasks\s*:\s*\{/;

    let insertPosition;
    let exportMatch;
    let isNestedCjs = false;

    if (esmPattern.test(indexContent)) {
      // ESM format: export default { ... }
      exportMatch = indexContent.match(esmPattern);
      insertPosition = indexContent.indexOf("\n", exportMatch.index) + 1;
    } else if (cjsTasksPattern.test(indexContent)) {
      // CommonJS with nested tasks: module.exports = { tasks: { ... } }
      exportMatch = indexContent.match(cjsTasksPattern);
      insertPosition = exportMatch.index + exportMatch[0].length;
      isNestedCjs = true;
    } else if (cjsPattern.test(indexContent)) {
      // CommonJS flat: module.exports = { ... }
      exportMatch = indexContent.match(cjsPattern);
      insertPosition = indexContent.indexOf("\n", exportMatch.index) + 1;
    } else {
      return sendJson(res, 500, {
        error:
          "Failed to find export pattern in index.js (expected 'export default {' or 'module.exports = {')",
      });
    }

    // Insert new task entry after the opening brace line
    // For nested CommonJS, check if we need to add newline to expand single-line format
    let newEntry;
    if (isNestedCjs) {
      // Check if there's already a newline (multi-line format)
      // Skip any whitespace before checking for newline
      const remainingContent = indexContent.slice(insertPosition);
      if (/^\s*\n/.test(remainingContent)) {
        // Multi-line format: skip whitespace and newline, insert at next position
        const whitespaceMatch = remainingContent.match(/^\s*\n/);
        insertPosition += whitespaceMatch[0].length;
        newEntry = `  ${taskName}: "./${filename}",\n`;
      } else {
        // Single-line format: add newline to expand it
        newEntry = `\n  ${taskName}: "./${filename}",\n`;
      }
    } else {
      newEntry = `  ${taskName}: "./${filename}",\n`;
    }

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