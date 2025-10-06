/**
 * Safe file reader with structured error handling and retry logic
 * @module ui/file-reader
 */

import { promises as fs } from "node:fs";
import { Constants, createErrorResponse } from "./config-bridge.js";

/**
 * Reads a JSON file safely with error handling and size limits
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<Object>} Result with parsed JSON or error
 */
export async function readJSONFile(filePath) {
  try {
    // Check file size before reading
    const stats = await fs.stat(filePath);
    if (stats.size > Constants.FILE_LIMITS.MAX_FILE_SIZE) {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        `File too large: ${stats.size} bytes exceeds limit of ${Constants.FILE_LIMITS.MAX_FILE_SIZE} bytes`,
        filePath
      );
    }

    // Read file with UTF-8 encoding
    const content = await fs.readFile(filePath, "utf8");

    // Handle BOM if present
    const cleanContent = content.replace(/^\uFEFF/, "");

    // Parse JSON
    try {
      const parsed = JSON.parse(cleanContent);
      return {
        ok: true,
        data: parsed,
        path: filePath,
      };
    } catch (parseError) {
      return createErrorResponse(
        Constants.ERROR_CODES.INVALID_JSON,
        `Invalid JSON: ${parseError.message}`,
        filePath
      );
    }
  } catch (error) {
    // Handle file system errors
    if (error.code === "ENOENT") {
      return createErrorResponse(
        Constants.ERROR_CODES.NOT_FOUND,
        "File not found",
        filePath
      );
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        `Permission denied: ${error.message}`,
        filePath
      );
    }

    // Generic file system error
    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      `File system error: ${error.message}`,
      filePath
    );
  }
}

/**
 * Reads a file with retry logic for atomic operations
 * @param {string} filePath - Path to the file
 * @param {Object} [options] - Retry options
 * @param {number} [options.maxAttempts=Constants.RETRY_CONFIG.MAX_ATTEMPTS] - Maximum retry attempts
 * @param {number} [options.delayMs=Constants.RETRY_CONFIG.DELAY_MS] - Delay between retries in ms
 * @returns {Promise<Object>} Result with file content or error
 */
export async function readFileWithRetry(filePath, options = {}) {
  const {
    maxAttempts = Constants.RETRY_CONFIG.MAX_ATTEMPTS,
    delayMs = Constants.RETRY_CONFIG.DELAY_MS,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await readJSONFile(filePath);

    // If successful, return result
    if (result.ok) {
      if (attempt > 1) {
        console.log(
          `File read succeeded after ${attempt} attempts: ${filePath}`
        );
      }
      return result;
    }

    // If it's a JSON parse error, retry once (writer might be mid-write)
    if (
      result.code === Constants.ERROR_CODES.INVALID_JSON &&
      attempt < maxAttempts
    ) {
      console.log(
        `JSON parse error on attempt ${attempt}, retrying: ${filePath}`
      );
      lastError = result;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    // For other errors, don't retry
    return result;
  }

  // All retries exhausted
  console.warn(
    `File read failed after ${maxAttempts} attempts: ${filePath}`,
    lastError
  );
  return lastError;
}

/**
 * Reads multiple JSON files in parallel
 * @param {string[]} filePaths - Array of file paths
 * @returns {Promise<Object[]>} Array of results
 */
export async function readMultipleJSONFiles(filePaths) {
  const results = await Promise.all(
    filePaths.map((filePath) => readJSONFile(filePath))
  );

  // Log statistics for instrumentation
  const successCount = results.filter((r) => r.ok).length;
  const errorCount = results.length - successCount;

  if (errorCount > 0) {
    console.log(
      `Read ${successCount}/${results.length} files successfully, ${errorCount} errors`
    );
  }

  return results;
}

/**
 * Validates file path and checks if it exists
 * @param {string} filePath - Path to check
 * @returns {Promise<Object>} Validation result
 */
export async function validateFilePath(filePath) {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        "Path is not a file",
        filePath
      );
    }

    if (stats.size > Constants.FILE_LIMITS.MAX_FILE_SIZE) {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        `File too large: ${stats.size} bytes`,
        filePath
      );
    }

    return {
      ok: true,
      path: filePath,
      size: stats.size,
      modified: stats.mtime,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return createErrorResponse(
        Constants.ERROR_CODES.NOT_FOUND,
        "File not found",
        filePath
      );
    }

    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      `Validation error: ${error.message}`,
      filePath
    );
  }
}

/**
 * Gets file reading statistics for instrumentation
 * @param {string[]} filePaths - Array of file paths that were read
 * @param {Object[]} results - Array of read results
 * @returns {Object} Reading statistics
 */
export function getFileReadingStats(filePaths, results) {
  const totalFiles = filePaths.length;
  const successCount = results.filter((r) => r.ok).length;
  const errorCount = totalFiles - successCount;

  const errorTypes = {};
  results.forEach((result) => {
    if (!result.ok) {
      errorTypes[result.code] = (errorTypes[result.code] || 0) + 1;
    }
  });

  return {
    totalFiles,
    successCount,
    errorCount,
    successRate: totalFiles > 0 ? (successCount / totalFiles) * 100 : 0,
    errorTypes,
  };
}
