import path from "node:path";
import { ensureSymlink } from "./symlink-utils.js";

/**
 * Creates a taskDir symlink bridge to ensure deterministic module resolution.
 *
 * This function creates three symlinks in the task directory:
 * - taskDir/node_modules -> {poRoot}/node_modules (for bare package specifiers)
 * - taskDir/project -> {poRoot} (optional convenience for absolute project paths)
 * - taskDir/_task_root -> dirname(taskModulePath) (for relative imports)
 *
 * @param {Object} options - Configuration options
 * @param {string} options.taskDir - The task directory where symlinks should be created
 * @param {string} options.poRoot - The repository root directory
 * @param {string} options.taskModulePath - Absolute path to the original task module
 * @returns {string} The relocated entry path for the task module
 * @throws {Error} If symlink creation fails
 */
export async function ensureTaskSymlinkBridge({
  taskDir,
  poRoot,
  taskModulePath,
}) {
  // Normalize all paths to absolute paths
  const normalizedTaskDir = path.resolve(taskDir);
  const normalizedPoRoot = path.resolve(poRoot);
  const normalizedTaskModulePath = path.resolve(taskModulePath);

  // Ensure the task directory exists
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(normalizedTaskDir, { recursive: true })
  );

  // Create symlink for node_modules -> {poRoot}/node_modules
  const nodeModulesLink = path.join(normalizedTaskDir, "node_modules");
  const nodeModulesTarget = path.join(normalizedPoRoot, "node_modules");
  await ensureSymlink(nodeModulesLink, nodeModulesTarget, "dir");

  // Create symlink for project -> {poRoot}
  const projectLink = path.join(normalizedTaskDir, "project");
  await ensureSymlink(projectLink, normalizedPoRoot, "dir");

  // Create symlink for _task_root -> dirname(taskModulePath)
  const taskRootLink = path.join(normalizedTaskDir, "_task_root");
  const taskRootTarget = path.dirname(normalizedTaskModulePath);
  await ensureSymlink(taskRootLink, taskRootTarget, "dir");

  // Return the relocated entry path
  const taskModuleBasename = path.basename(normalizedTaskModulePath);
  const relocatedEntry = path.join(
    normalizedTaskDir,
    "_task_root",
    taskModuleBasename
  );

  return relocatedEntry;
}
