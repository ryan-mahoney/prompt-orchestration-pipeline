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
    const analysis = analyzeTask(code);

    // Output as JSON
    console.log(JSON.stringify(analysis, null, 2));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Task file not found: ${taskPath}`);
      process.exit(1);
    }
    console.error(`Error analyzing task: ${error.message}`);
    process.exit(1);
  }
}
