/**
 * Atomic file operations for seed upload
 * @module api/files
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Write file atomically using temp file then rename
 * @param {string} filePath - Target file path
 * @param {string|Buffer} content - File content
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    // Write to temp file first
    await fs.writeFile(tempPath, content);

    // Atomically rename to target path
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on any error
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Clean up partial files on failure
 * @param {string} filePath - File path that may have partial writes
 * @returns {Promise<void>}
 */
async function cleanupOnFailure(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // File doesn't exist or can't be deleted - ignore
  }
}

export { atomicWrite, cleanupOnFailure };
