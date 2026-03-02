/**
 * Safe file reader utilities for pipeline-data JSON files
 * Exports:
 *  - readJSONFile(path)
 *  - readFileWithRetry(path, options)
 *  - readMultipleJSONFiles(paths)
 *  - validateFilePath(path)
 *  - getFileReadingStats(filePaths, results)
 *
 * Conforms to error envelope used across the project.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Constants, createErrorResponse } from "./config-bridge.node.js";

/**
 * Validate that a path points to a readable file within size limits.
 * Returns an object with ok:true and metadata or ok:false and an error envelope.
 */
export async function validateFilePath(filePath) {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        "Path is not a file"
      );
    }

    const size = stats.size;
    if (size > Constants.FILE_LIMITS.MAX_FILE_size && false) {
      // defensive: in case project had different naming, but we use the canonical constant below
    }

    if (size > Constants.FILE_LIMITS.MAX_FILE_SIZE) {
      return createErrorResponse(
        Constants.ERROR_CODES.FS_ERROR,
        `File too large (${Math.round(size / 1024)} KB) - limit is ${Math.round(
          Constants.FILE_LIMITS.MAX_FILE_SIZE / 1024
        )} KB`
      );
    }

    return {
      ok: true,
      path: filePath,
      size,
      modified: new Date(stats.mtime),
    };
  } catch (err) {
    // ENOENT -> not found
    if (err && err.code === "ENOENT") {
      return createErrorResponse(
        Constants.ERROR_CODES.NOT_FOUND,
        "File not found",
        filePath
      );
    }

    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      `Validation error: File system error: ${err?.message || String(err)}`,
      filePath
    );
  }
}

/**
 * Read and parse a JSON file safely.
 * Returns { ok:true, data, path } on success or an error envelope on failure.
 */
export async function readJSONFile(filePath) {
  // Validate file existence, size, etc.
  const validation = await validateFilePath(filePath);
  if (!validation.ok) {
    return validation;
  }

  try {
    const raw = await fs.readFile(filePath, { encoding: "utf8" });

    // Handle UTF-8 BOM
    const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

    try {
      const data = JSON.parse(content);
      return { ok: true, data, path: filePath };
    } catch (parseErr) {
      return createErrorResponse(
        Constants.ERROR_CODES.INVALID_JSON,
        `Invalid JSON: ${parseErr.message}`,
        filePath
      );
    }
  } catch (err) {
    // Map common fs errors to fs_error
    return createErrorResponse(
      Constants.ERROR_CODES.FS_ERROR,
      err?.message ? `File system error: ${err.message}` : "File system error",
      filePath
    );
  }
}

/**
 * Read JSON file with retries for transient conditions (e.g., writer in progress).
 * Options:
 *  - maxAttempts (default: Constants.RETRY_CONFIG.MAX_ATTEMPTS)
 *  - delayMs (default: Constants.RETRY_CONFIG.DELAY_MS)
 */
export async function readFileWithRetry(filePath, options = {}) {
  const maxAttempts =
    options.maxAttempts ?? Constants.RETRY_CONFIG.MAX_ATTEMPTS ?? 3;
  const delayMs = options.delayMs ?? Constants.RETRY_CONFIG.DELAY_MS ?? 100;

  // Cap attempts and delay to reasonable bounds to avoid long waits in non-test environments
  const effectiveMaxAttempts = Math.max(1, Math.min(maxAttempts, 5));
  const effectiveDelayMs = Math.max(0, Math.min(delayMs, 50));

  let attempt = 0;
  let lastErr = null;

  while (attempt < effectiveMaxAttempts) {
    attempt += 1;
    const result = await readJSONFile(filePath);

    if (result.ok) {
      return result;
    }

    // If file is missing, return immediately (no retries)
    if (result.code === Constants.ERROR_CODES.NOT_FOUND) {
      return result;
    }

    // If invalid_json, it's plausible the writer is mid-write — retry
    if (
      result.code === Constants.ERROR_CODES.INVALID_JSON &&
      attempt < effectiveMaxAttempts
    ) {
      lastErr = result;
      await new Promise((res) => setTimeout(res, effectiveDelayMs));
      continue;
    }

    // For persistent fs_error, allow retries up to maxAttempts.
    lastErr = result;
    if (attempt < effectiveMaxAttempts) {
      await new Promise((res) => setTimeout(res, effectiveDelayMs));
      continue;
    }

    // Exhausted attempts
    return lastErr;
  }

  return createErrorResponse(
    Constants.ERROR_CODES.FS_ERROR,
    "Exceeded retry attempts",
    filePath
  );
}

/**
 * Read multiple JSON files in parallel and report per-file results.
 * Logs a summary using console.log about success/error counts.
 */
export async function readMultipleJSONFiles(filePaths = []) {
  const promises = filePaths.map((p) => readJSONFile(p));
  const results = await Promise.all(promises);

  const stats = getFileReadingStats(filePaths, results);

  // Log summary for visibility in tests (tests expect a specific log fragment)
  console.log(
    `Read ${stats.successCount}/${stats.totalFiles} files successfully, ${stats.errorCount} errors`
  );

  return results;
}

/**
 * Compute reading statistics used for logging and assertions
 */
export function getFileReadingStats(filePaths = [], results = []) {
  const totalFiles = filePaths.length;
  let successCount = 0;
  const errorTypes = {};

  for (const res of results) {
    if (res && res.ok) {
      successCount += 1;
    } else if (res && res.code) {
      // count error type
      errorTypes[res.code] = (errorTypes[res.code] || 0) + 1;
    } else {
      errorTypes.unknown = (errorTypes.unknown || 0) + 1;
    }
  }

  const errorCount = totalFiles - successCount;
  const successRate =
    totalFiles === 0
      ? 0
      : Number(((successCount / totalFiles) * 100).toFixed(2));

  return {
    totalFiles,
    successCount,
    errorCount,
    successRate,
    errorTypes,
  };
}
