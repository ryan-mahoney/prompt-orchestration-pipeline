import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface SymlinkBridgeResult {
  relocatedEntryPath: string;
}

async function ensureSymlink(linkPath: string, targetPath: string): Promise<void> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      throw new Error(`Expected symlink at ${linkPath}`);
    }
    const existingTarget = await readlink(linkPath);
    if (resolve(dirname(linkPath), existingTarget) === resolve(targetPath)) {
      return;
    }
    await unlink(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await symlink(targetPath, linkPath, "dir");
}

export async function ensureTaskSymlinkBridge(
  workDir: string,
  taskName: string,
  _registryDir: string,
  modulePath: string,
  poRoot?: string,
): Promise<SymlinkBridgeResult> {
  const taskDir = join(workDir, "tasks", taskName);
  const taskRootLink = join(taskDir, "_task_root");
  const nodeModulesLink = join(taskDir, "node_modules");
  const nodeModulesTarget = join(poRoot ?? workDir, "node_modules");

  await mkdir(taskDir, { recursive: true });
  await ensureSymlink(taskRootLink, dirname(modulePath));
  await ensureSymlink(nodeModulesLink, nodeModulesTarget);

  return { relocatedEntryPath: join(taskRootLink, basename(modulePath)) };
}
