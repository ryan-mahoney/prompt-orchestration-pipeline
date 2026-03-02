import fs from "node:fs/promises";
import path from "node:path";

/**
 * Analyze a task file and output the analysis as JSON.
 *
 * @param {string} taskPath - Path to the task file
 * @returns {Promise<void>}
 */
export async function analyzeTaskFile(taskPath) {
  try {
    // Use dynamic import to handle ESM/CommonJS interop for @babel/traverse
    const { analyzeTask } = await import("../task-analysis/index.js");

    // Resolve the task path (handle both relative and absolute paths)
    const absolutePath = path.isAbsolute(taskPath)
      ? taskPath
      : path.resolve(process.cwd(), taskPath);

    // Read the task file
    const code = await fs.readFile(absolutePath, "utf8");

    // Run analysis
    const analysis = analyzeTask(code, absolutePath);

    // Output as JSON
    console.log(JSON.stringify(analysis, null, 2));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.error(`Error: Task file not found: ${taskPath}`);
      process.exit(1);
    }

    const isDev =
      process.env.NODE_ENV === "development" ||
      process.env.DEBUG_TASK_ANALYSIS === "1";

    console.error("Error analyzing task:");

    if (isDev) {
      // In development/debug mode, preserve full error context (including stack trace)
      console.error(error && error.stack ? error.stack : error);
    } else if (error && typeof error.message === "string") {
      // In normal mode, show a concise message while keeping the library's formatting
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}
