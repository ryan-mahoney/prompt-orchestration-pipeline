import fs from "node:fs/promises";
import path from "node:path";

/**
 * Creates an idempotent symlink, safely handling existing files/symlinks.
 *
 * @param {string} linkPath - Path where the symlink should be created
 * @param {string} targetPath - Path that the symlink should point to
 * @param {'file' | 'dir'} type - Type of symlink to create
 * @throws {Error} If symlink creation fails on non-POSIX systems
 */
export async function ensureSymlink(linkPath, targetPath, type) {
  try {
    // Check if linkPath already exists
    const stats = await fs.lstat(linkPath).catch(() => null);

    if (stats) {
      if (stats.isSymbolicLink()) {
        // If it's already a symlink pointing to the correct target, we're done
        const existingTarget = await fs.readlink(linkPath);
        if (existingTarget === targetPath) {
          return;
        }
        // If it points to a different target, remove it
        await fs.unlink(linkPath);
      } else if (stats.isDirectory()) {
        // If it's a directory, remove it recursively
        await fs.rmdir(linkPath, { recursive: true });
      } else {
        // If it's a file, remove it
        await fs.unlink(linkPath);
      }
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(linkPath);
    await fs.mkdir(parentDir, { recursive: true });

    // Create the symlink
    await fs.symlink(targetPath, linkPath, type);
  } catch (error) {
    // Re-throw with more context
    throw new Error(
      `Failed to create symlink from ${linkPath} -> ${targetPath}: ${error.message}`
    );
  }
}
