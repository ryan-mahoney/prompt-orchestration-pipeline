import { lstat, readdir, readlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureTaskSymlinkBridge } from "./symlink-bridge";

function getTaskDir(workDir: string, taskName: string): string {
  return join(workDir, "tasks", taskName);
}

async function isMatchingSymlink(linkPath: string, expectedTarget: string): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }
    const target = await readlink(linkPath);
    return resolve(dirname(linkPath), target) === resolve(expectedTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function validateTaskSymlinks(
  workDir: string,
  taskName: string,
  taskModulePath: string,
  poRoot: string,
): Promise<boolean> {
  const taskDir = getTaskDir(workDir, taskName);
  const [taskRootValid, nodeModulesValid] = await Promise.all([
    isMatchingSymlink(join(taskDir, "_task_root"), dirname(taskModulePath)),
    isMatchingSymlink(join(taskDir, "node_modules"), join(poRoot, "node_modules")),
  ]);
  return taskRootValid && nodeModulesValid;
}

export async function repairTaskSymlinks(
  workDir: string,
  taskName: string,
  taskModulePath: string,
  poRoot: string,
): Promise<void> {
  await ensureTaskSymlinkBridge(workDir, taskName, dirname(taskModulePath), taskModulePath, poRoot);
}

async function removeSymlinkIfPresent(linkPath: string): Promise<void> {
  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      await unlink(linkPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function cleanupTaskSymlinks(jobDir: string): Promise<void> {
  const tasksDir = join(jobDir, "tasks");
  let entries: string[];
  try {
    entries = await readdir(tasksDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const taskDir = join(tasksDir, entry);
    await removeSymlinkIfPresent(join(taskDir, "_task_root"));
    await removeSymlinkIfPresent(join(taskDir, "node_modules"));
  }));
}
