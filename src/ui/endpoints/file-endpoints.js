/**
 * File endpoint handlers for task file operations
 */

import fs from "fs";
import path from "path";
import { sendJson } from "../utils/http-utils.js";
import { getMimeType, isTextMime } from "../utils/mime-types.js";
import { getJobDirectoryPath } from "../../config/paths.js";

const exists = async (p) =>
  fs.promises
    .access(p)
    .then(() => true)
    .catch(() => false);

/**
 * Resolve job lifecycle directory deterministically
 * @param {string} dataDir - Base data directory
 * @param {string} jobId - Job identifier
 * @returns {Promise<string|null>} One of "current", "complete", "rejected", or null if job not found
 */
async function resolveJobLifecycle(dataDir, jobId) {
  const currentJobDir = getJobDirectoryPath(dataDir, jobId, "current");
  const completeJobDir = getJobDirectoryPath(dataDir, jobId, "complete");
  const rejectedJobDir = getJobDirectoryPath(dataDir, jobId, "rejected");

  // Check in order of preference: current > complete > rejected
  const currentExists = await exists(currentJobDir);
  const completeExists = await exists(completeJobDir);
  const rejectedExists = await exists(rejectedJobDir);

  if (currentExists) {
    return "current";
  }

  if (completeExists) {
    return "complete";
  }

  if (rejectedExists) {
    return "rejected";
  }

  // Job not found in any lifecycle
  return null;
}

/**
 * Consolidated path jail security validation with generic error messages
 * @param {string} filename - Filename to validate
 * @returns {Object|null} Validation result or null if valid
 */
export function validateFilePath(filename) {
  // Check for path traversal patterns
  if (filename.includes("..")) {
    console.error("Path security: path traversal detected", { filename });
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Check for absolute paths (POSIX, Windows, backslashes, ~)
  if (
    path.isAbsolute(filename) ||
    /^[a-zA-Z]:/.test(filename) ||
    filename.includes("\\") ||
    filename.startsWith("~")
  ) {
    console.error("Path security: absolute path detected", { filename });
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Check for empty filename
  if (!filename || filename.trim() === "") {
    console.error("Path security: empty filename detected");
    return {
      allowed: false,
      message: "Path validation failed",
    };
  }

  // Path is valid
  return null;
}

/**
 * Handle task file list request with validation and security checks
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 * @param {Object} params - Request parameters
 * @param {string} params.jobId - Job ID
 * @param {string} params.taskId - Task ID
 * @param {string} params.type - File type (artifacts, logs, tmp)
 * @param {string} params.dataDir - Data directory
 */
export async function handleTaskFileListRequest(
  req,
  res,
  { jobId, taskId, type, dataDir }
) {
  // Resolve job lifecycle deterministically
  const lifecycle = await resolveJobLifecycle(dataDir, jobId);
  if (!lifecycle) {
    // Job not found, return empty list
    sendJson(res, 200, {
      ok: true,
      data: {
        files: [],
        jobId,
        taskId,
        type,
      },
    });
    return;
  }

  // Use single lifecycle directory
  const jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);
  const taskDir = path.join(jobDir, "files", type);

  // Use path.relative for stricter jail enforcement
  const resolvedPath = path.resolve(taskDir);
  const relativePath = path.relative(jobDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    console.error("Path security: directory traversal detected", {
      taskDir,
      relativePath,
    });
    sendJson(res, 403, {
      ok: false,
      error: "forbidden",
      message: "Path validation failed",
    });
    return;
  }

  // Check if directory exists
  if (!(await exists(taskDir))) {
    // Directory doesn't exist, return empty list
    sendJson(res, 200, {
      ok: true,
      data: {
        files: [],
        jobId,
        taskId,
        type,
      },
    });
    return;
  }

  try {
    // Read directory contents
    const entries = await fs.promises.readdir(taskDir, {
      withFileTypes: true,
    });

    // Filter and map to file list
    const files = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        // Validate each filename using the consolidated function
        const validation = validateFilePath(entry.name);
        if (validation) {
          console.error("Path security: skipping invalid file", {
            filename: entry.name,
            reason: validation.message,
          });
          continue; // Skip files that fail validation
        }

        const filePath = path.join(taskDir, entry.name);
        const stats = await fs.promises.stat(filePath);

        files.push({
          name: entry.name,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          mime: getMimeType(entry.name),
        });
      }
    }

    // Sort files by name
    files.sort((a, b) => a.name.localeCompare(b.name));

    // Send successful response
    sendJson(res, 200, {
      ok: true,
      data: {
        files,
        jobId,
        taskId,
        type,
      },
    });
  } catch (error) {
    console.error("Error listing files:", error);
    sendJson(res, 500, {
      ok: false,
      error: "internal_error",
      message: "Failed to list files",
    });
  }
}

/**
 * Handle task file request with validation, jail checks, and proper encoding
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 * @param {Object} params - Request parameters
 * @param {string} params.jobId - Job ID
 * @param {string} params.taskId - Task ID
 * @param {string} params.type - File type (artifacts, logs, tmp)
 * @param {string} params.filename - Filename
 * @param {string} params.dataDir - Data directory
 */
export async function handleTaskFileRequest(
  req,
  res,
  { jobId, taskId, type, filename, dataDir }
) {
  // Unified security validation
  const validation = validateFilePath(filename);
  if (validation) {
    sendJson(res, 403, {
      ok: false,
      error: "forbidden",
      message: validation.message,
    });
    return;
  }

  // Resolve job lifecycle deterministically
  const lifecycle = await resolveJobLifecycle(dataDir, jobId);
  if (!lifecycle) {
    sendJson(res, 404, {
      ok: false,
      error: "not_found",
      message: "Job not found",
    });
    return;
  }

  // Use single lifecycle directory
  const jobDir = getJobDirectoryPath(dataDir, jobId, lifecycle);
  const taskDir = path.join(jobDir, "files", type);
  const filePath = path.join(taskDir, filename);

  // Use path.relative for stricter jail enforcement
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(jobDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, {
      ok: false,
      error: "forbidden",
      message: "Path resolves outside allowed directory",
    });
    return;
  }

  // Check if file exists
  if (!(await exists(filePath))) {
    sendJson(res, 404, {
      ok: false,
      error: "not_found",
      message: "File not found",
      filePath,
    });
    return;
  }

  try {
    // Get file stats
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      sendJson(res, 404, {
        ok: false,
        error: "not_found",
        message: "Not a regular file",
      });
      return;
    }

    // Determine MIME type and encoding
    const mime = getMimeType(filename);
    const isText = isTextMime(mime);
    const encoding = isText ? "utf8" : "base64";

    // Read file content
    let content;
    if (isText) {
      content = await fs.promises.readFile(filePath, "utf8");
    } else {
      const buffer = await fs.promises.readFile(filePath);
      content = buffer.toString("base64");
    }

    // Build relative path for response
    const relativePath = path.join("tasks", taskId, type, filename);

    // Send successful response
    sendJson(res, 200, {
      ok: true,
      jobId,
      taskId,
      type,
      path: relativePath,
      mime,
      size: stats.size,
      mtime: stats.mtime.toISOString(),
      encoding,
      content,
    });
  } catch (error) {
    console.error("Error reading file:", error);
    sendJson(res, 500, {
      ok: false,
      error: "internal_error",
      message: "Failed to read file",
    });
  }
}
