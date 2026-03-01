import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "./logger.js";
import { ensureTaskSymlinkBridge } from "./symlink-bridge.js";

const logger = createLogger("SymlinkUtils");

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

/**
 * Validates that required task symlinks exist and point to accessible targets.
 *
 * @param {string} taskDir - The task directory containing symlinks
 * @param {Object} expectedTargets - Expected symlink targets
 * @param {string} expectedTargets.nodeModules - Expected target for node_modules symlink
 * @param {string} expectedTargets.taskRoot - Expected target for _task_root symlink
 * @returns {Object} Validation result with isValid flag and details
 */
export async function validateTaskSymlinks(taskDir, expectedTargets) {
  const startTime = Date.now();
  const validationErrors = [];
  const validationDetails = {};

  const symlinksToValidate = [
    { name: "node_modules", expectedTarget: expectedTargets.nodeModules },
    { name: "_task_root", expectedTarget: expectedTargets.taskRoot },
  ];

  for (const { name, expectedTarget } of symlinksToValidate) {
    const linkPath = path.join(taskDir, name);

    try {
      // Check if symlink exists
      const stats = await fs.lstat(linkPath);

      if (!stats.isSymbolicLink()) {
        validationErrors.push(
          `${name} exists but is not a symlink (type: ${stats.isFile() ? "file" : "directory"})`
        );
        validationDetails[name] = {
          exists: true,
          isSymlink: false,
          targetAccessible: false,
        };
        continue;
      }

      // Read the symlink target
      const actualTarget = await fs.readlink(linkPath);

      // Check if target matches expected (normalize paths for comparison)
      const normalizedActual = path.resolve(taskDir, actualTarget);
      const normalizedExpected = path.resolve(expectedTarget);

      if (normalizedActual !== normalizedExpected) {
        validationErrors.push(
          `${name} points to wrong target: expected ${expectedTarget}, got ${actualTarget}`
        );
        validationDetails[name] = {
          exists: true,
          isSymlink: true,
          targetAccessible: false,
          actualTarget,
          expectedTarget,
        };
        continue;
      }

      // Check if target is accessible
      const targetStats = await fs.stat(normalizedActual).catch(() => null);
      if (!targetStats) {
        validationErrors.push(
          `${name} target is not accessible: ${actualTarget}`
        );
        validationDetails[name] = {
          exists: true,
          isSymlink: true,
          targetAccessible: false,
          actualTarget,
        };
        continue;
      }

      if (!targetStats.isDirectory()) {
        validationErrors.push(
          `${name} target is not a directory: ${actualTarget}`
        );
        validationDetails[name] = {
          exists: true,
          isSymlink: true,
          targetAccessible: false,
          actualTarget,
          targetType: "file",
        };
        continue;
      }

      // Symlink is valid
      validationDetails[name] = {
        exists: true,
        isSymlink: true,
        targetAccessible: true,
        actualTarget,
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        validationErrors.push(`${name} symlink does not exist`);
        validationDetails[name] = {
          exists: false,
          isSymlink: false,
          targetAccessible: false,
        };
      } else {
        validationErrors.push(`${name} validation failed: ${error.message}`);
        validationDetails[name] = {
          exists: false,
          isSymlink: false,
          targetAccessible: false,
          error: error.message,
        };
      }
    }
  }

  const isValid = validationErrors.length === 0;
  const duration = Date.now() - startTime;

  logger.debug("Symlink validation completed", {
    taskDir,
    isValid,
    errorsCount: validationErrors.length,
    duration,
    details: validationDetails,
  });

  return {
    isValid,
    errors: validationErrors,
    details: validationDetails,
    duration,
  };
}

/**
 * Repairs task symlinks by recreating them using the existing symlink bridge.
 *
 * @param {string} taskDir - The task directory where symlinks should be created
 * @param {string} poRoot - The repository root directory
 * @param {string} taskModulePath - Absolute path to the original task module
 * @returns {Object} Repair result with success flag and details
 */
export async function repairTaskSymlinks(taskDir, poRoot, taskModulePath) {
  const startTime = Date.now();

  try {
    // Use existing ensureTaskSymlinkBridge for repairs
    const relocatedEntry = await ensureTaskSymlinkBridge({
      taskDir,
      poRoot,
      taskModulePath,
    });

    const duration = Date.now() - startTime;

    return {
      success: true,
      relocatedEntry,
      duration,
      errors: [],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = `Failed to repair task symlinks: ${error.message}`;

    logger.error("Task symlink repair failed", {
      taskDir,
      poRoot,
      taskModulePath,
      duration,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      relocatedEntry: null,
      duration,
      errors: [errorMessage],
    };
  }
}

/**
 * Removes task symlinks from a completed job directory to avoid dangling links.
 *
 * @param {string} completedJobDir - Path to the completed job directory (e.g., COMPLETE_DIR/jobId)
 */
export async function cleanupTaskSymlinks(completedJobDir) {
  const tasksDir = path.join(completedJobDir, "tasks");

  try {
    // Check if tasks directory exists
    const tasksStats = await fs.lstat(tasksDir).catch(() => null);
    if (!tasksStats || !tasksStats.isDirectory()) {
      return; // No tasks directory to clean up
    }

    // Get all task directories
    const taskDirs = await fs.readdir(tasksDir, { withFileTypes: true });

    for (const taskDir of taskDirs) {
      if (!taskDir.isDirectory()) continue;

      const taskPath = path.join(tasksDir, taskDir.name);

      // Remove specific symlinks if they exist and are actually symlinks
      const symlinksToRemove = ["node_modules", "project", "_task_root"];

      for (const linkName of symlinksToRemove) {
        const linkPath = path.join(taskPath, linkName);

        try {
          const stats = await fs.lstat(linkPath);
          if (stats.isSymbolicLink()) {
            await fs.unlink(linkPath);
          }
        } catch {
          // Ignore errors (file doesn't exist, permissions, etc.)
        }
      }
    }
  } catch (error) {
    // Log but don't fail - cleanup is optional
    logger.warn("Failed to cleanup task symlinks", {
      directory: completedJobDir,
      error: error.message,
    });
  }
}
