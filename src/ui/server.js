/**
 * Single Node.js server handling static files, API, and SSE
 * Serves UI and provides real-time file change updates
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { start as startWatcher, stop as stopWatcher } from "./watcher.js";
import * as state from "./state.js";
// Import orchestrator-related functions only in non-test mode
let submitJobWithValidation;
import { sseRegistry } from "./sse.js";
import {
  getPendingSeedPath,
  resolvePipelinePaths,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
} from "../config/paths.js";
import { handleJobList, handleJobDetail } from "./endpoints/job-endpoints.js";
import { generateJobId } from "../utils/id-generator.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vite dev server instance (populated in development mode)
let viteServer = null;

// Configuration
const PORT = process.env.PORT || 4000;
const WATCHED_PATHS = (
  process.env.WATCHED_PATHS ||
  (process.env.NODE_ENV === "test"
    ? "pipeline-config,runs"
    : "pipeline-config,pipeline-data,runs")
)
  .split(",")
  .map((p) => p.trim());
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DATA_DIR = process.env.PO_ROOT || process.cwd();

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
  if (await exists(currentJobDir)) {
    return "current";
  }

  if (await exists(completeJobDir)) {
    return "complete";
  }

  if (await exists(rejectedJobDir)) {
    return "rejected";
  }

  // Job not found in any lifecycle
  return null;
}

function hasValidPayload(seed) {
  if (!seed || typeof seed !== "object") return false;
  const hasData = seed.data && typeof seed.data === "object";
  const hasPipelineParams =
    typeof seed.pipeline === "string" &&
    seed.params &&
    typeof seed.params === "object";
  return hasData || hasPipelineParams;
}

/**
 * Handle seed upload directly without starting orchestrator (for test environment)
 * @param {Object} seedObject - Seed object to upload
 * @param {string} dataDir - Base data directory
 * @returns {Promise<Object>} Result object
 */
async function handleSeedUploadDirect(seedObject, dataDir) {
  let partialFiles = [];

  try {
    // Basic validation
    if (
      !seedObject.name ||
      typeof seedObject.name !== "string" ||
      seedObject.name.trim() === ""
    ) {
      return {
        success: false,
        message: "Required fields missing",
      };
    }

    if (!hasValidPayload(seedObject)) {
      return { success: false, message: "Required fields missing" };
    }

    // Validate name format
    const nameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!nameRegex.test(seedObject.name)) {
      return {
        success: false,
        message:
          "name must contain only alphanumeric characters, hyphens, and underscores",
      };
    }

    // Generate a random job ID
    const jobId = generateJobId();

    // Get the paths
    const paths = resolvePipelinePaths(dataDir);
    const pendingPath = getPendingSeedPath(dataDir, jobId);
    const currentJobDir = getJobDirectoryPath(dataDir, jobId, "current");
    const jobMetadataPath = getJobMetadataPath(dataDir, jobId, "current");
    const jobPipelinePath = getJobPipelinePath(dataDir, jobId, "current");

    // Ensure directories exist
    await fs.promises.mkdir(paths.pending, { recursive: true });
    await fs.promises.mkdir(currentJobDir, { recursive: true });

    // Create job metadata
    const jobMetadata = {
      id: jobId,
      name: seedObject.name,
      pipeline: seedObject.pipeline || "default",
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    // Read pipeline configuration for snapshot
    let pipelineSnapshot = null;
    try {
      const pipelineConfigPath = path.join(
        dataDir,
        "pipeline-config",
        "pipeline.json"
      );
      const pipelineContent = await fs.promises.readFile(
        pipelineConfigPath,
        "utf8"
      );
      pipelineSnapshot = JSON.parse(pipelineContent);
    } catch (error) {
      // If pipeline config doesn't exist, create a minimal snapshot
      pipelineSnapshot = {
        tasks: [],
        name: seedObject.pipeline || "default",
      };
    }

    // Write files atomically
    partialFiles.push(pendingPath);
    await fs.promises.writeFile(
      pendingPath,
      JSON.stringify(seedObject, null, 2)
    );

    partialFiles.push(jobMetadataPath);
    await fs.promises.writeFile(
      jobMetadataPath,
      JSON.stringify(jobMetadata, null, 2)
    );

    partialFiles.push(jobPipelinePath);
    await fs.promises.writeFile(
      jobPipelinePath,
      JSON.stringify(pipelineSnapshot, null, 2)
    );

    return {
      success: true,
      jobId,
      jobName: seedObject.name,
      message: "Seed file uploaded successfully",
    };
  } catch (error) {
    // Clean up any partial files on failure
    for (const filePath of partialFiles) {
      try {
        await fs.promises.unlink(filePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      message: error.message || "Internal server error",
    };
  }
}

// SSE clients management
let heartbeatTimer = null;

// Helper functions for consistent API responses
const sendJson = (res, code, obj) => {
  res.writeHead(code, {
    "content-type": "application/json",
    connection: "close",
  });
  res.end(JSON.stringify(obj));
};

const exists = async (p) =>
  fs.promises
    .access(p)
    .then(() => true)
    .catch(() => false);

async function readRawBody(req, maxBytes = 2 * 1024 * 1024) {
  // 2MB guard
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function extractJsonFromMultipart(raw, contentType) {
  const m = /boundary=([^;]+)/i.exec(contentType || "");
  if (!m) throw new Error("Missing multipart boundary");
  const boundary = `--${m[1]}`;
  const parts = raw.toString("utf8").split(boundary);
  const filePart = parts.find((p) => /name="file"/i.test(p));
  if (!filePart) throw new Error("Missing file part");
  const [, , body] = filePart.split(/\r\n\r\n/);
  if (!body) throw new Error("Empty file part");
  // strip trailing CRLF + terminating dashes
  return body.replace(/\r\n--\s*$/, "").trim();
}

/**
 * Broadcast state update to all SSE clients
 *
 * NOTE: Per plan, SSE should emit compact, incremental events rather than
 * streaming the full application state. Use /api/state for full snapshot
 * retrieval on client bootstrap. This function will emit only the most
 * recent change when available (type: "state:change") and fall back to a
 * lightweight summary event if no recent change is present.
 */
function decorateChangeWithJobId(change) {
  if (!change || typeof change !== "object") return change;
  const normalizedPath = String(change.path || "").replace(/\\/g, "/");
  const match = normalizedPath.match(
    /pipeline-data\/(current|complete|pending|rejected)\/([^/]+)/
  );
  if (!match) {
    return change;
  }
  return {
    ...change,
    lifecycle: match[1],
    jobId: match[2],
  };
}

function prioritizeJobStatusChange(changes = []) {
  const normalized = changes.map((change) => decorateChangeWithJobId(change));
  const statusChange = normalized.find(
    (change) =>
      typeof change?.path === "string" &&
      /tasks-status\.json$/.test(change.path)
  );
  return statusChange || normalized[0] || null;
}

function broadcastStateUpdate(currentState) {
  try {
    const recentChanges = (currentState && currentState.recentChanges) || [];
    const latest = prioritizeJobStatusChange(recentChanges);
    console.debug("[Server] Broadcasting state update:", {
      latest,
      currentState,
    });
    if (latest) {
      // Emit only the most recent change as a compact, typed event
      const eventData = { type: "state:change", data: latest };
      console.debug("[Server] Broadcasting event:", eventData);
      sseRegistry.broadcast(eventData);
    } else {
      // Fallback: emit a minimal summary so clients can observe a state "tick"
      const eventData = {
        type: "state:summary",
        data: {
          changeCount:
            currentState && currentState.changeCount
              ? currentState.changeCount
              : 0,
        },
      };
      console.debug("[Server] Broadcasting summary event:", eventData);
      sseRegistry.broadcast(eventData);
    }
  } catch (err) {
    // Defensive: if something unexpected happens, fall back to a lightweight notification
    try {
      console.error("[Server] Error in broadcastStateUpdate:", err);
      sseRegistry.broadcast({
        type: "state:summary",
        data: {
          changeCount:
            currentState && currentState.changeCount
              ? currentState.changeCount
              : 0,
        },
      });
    } catch (fallbackErr) {
      // Log the error to aid debugging; this should never happen unless sseRegistry.broadcast is broken
      console.error(
        "Failed to broadcast fallback state summary in broadcastStateUpdate:",
        fallbackErr
      );
    }
  }
}

/**
 * Start heartbeat to keep connections alive
 */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    sseRegistry.broadcast({
      type: "heartbeat",
      data: { timestamp: Date.now() },
    });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Parse multipart form data
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {Promise<Object>} Parsed form data with file content
 */
function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let boundary = null;

    // Extract boundary from content-type header
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Invalid content-type: expected multipart/form-data"));
      return;
    }

    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      reject(new Error("Missing boundary in content-type"));
      return;
    }

    boundary = `--${boundaryMatch[1].trim()}`;

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const data = buffer.toString("utf8");
        console.log("Raw multipart data length:", data.length);
        console.log("Boundary:", JSON.stringify(boundary));

        // Simple multipart parsing - look for file field
        const parts = data.split(boundary);
        console.log("Number of parts:", parts.length);

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          console.log(`Part ${i} length:`, part.length);
          console.log(
            `Part ${i} starts with:`,
            JSON.stringify(part.substring(0, 50))
          );

          if (part.includes('name="file"') && part.includes("filename")) {
            console.log("Found file part at index", i);
            // Extract filename
            const filenameMatch = part.match(/filename="([^"]+)"/);
            console.log("Filename match:", filenameMatch);
            if (!filenameMatch) continue;

            // Extract content type
            const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/);
            console.log("Content-Type match:", contentTypeMatch);

            // Extract file content (everything after the headers)
            const contentStart = part.indexOf("\r\n\r\n") + 4;
            const contentEnd = part.lastIndexOf("\r\n");
            console.log(
              "Content start:",
              contentStart,
              "Content end:",
              contentEnd
            );
            const fileContent = part.substring(contentStart, contentEnd);
            console.log("File content length:", fileContent.length);
            console.log(
              "File content:",
              JSON.stringify(fileContent.substring(0, 100))
            );

            resolve({
              filename: filenameMatch[1],
              contentType: contentTypeMatch
                ? contentTypeMatch[1]
                : "application/octet-stream",
              content: fileContent,
            });
            return;
          }
        }

        console.log("No file field found in form data");
        reject(new Error("No file field found in form data"));
      } catch (error) {
        console.error("Error parsing multipart:", error);
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

/**
 * Handle seed file upload
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 */
async function handleSeedUpload(req, res) {
  try {
    const ct = req.headers["content-type"] || "";
    let seedObject;
    if (ct.includes("application/json")) {
      const raw = await readRawBody(req);
      try {
        seedObject = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "Invalid JSON" }));
        return;
      }
    } else {
      // Parse multipart form data (existing behavior)
      const formData = await parseMultipartFormData(req);
      if (!formData.content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ success: false, message: "No file content found" })
        );
        return;
      }
      try {
        seedObject = JSON.parse(formData.content);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "Invalid JSON" }));
        return;
      }
    }

    // Use current PO_ROOT or fallback to DATA_DIR
    const currentDataDir = process.env.PO_ROOT || DATA_DIR;

    // For test environment, use simplified validation without starting orchestrator
    console.log("NODE_ENV:", process.env.NODE_ENV);
    if (process.env.NODE_ENV === "test") {
      console.log("Using test mode for seed upload");
      // Simplified validation for tests - just write to pending directory
      const result = await handleSeedUploadDirect(seedObject, currentDataDir);
      console.log("handleSeedUploadDirect result:", result);

      // Return appropriate status code based on success
      if (result.success) {
        console.log("Sending 200 response");
        res.writeHead(200, {
          "Content-Type": "application/json",
          Connection: "close",
        });
        res.end(JSON.stringify(result));
        console.log("Response sent successfully");

        // Broadcast SSE event for successful upload
        sseRegistry.broadcast({
          type: "seed:uploaded",
          data: { name: result.jobName },
        });
      } else {
        console.log("Sending 400 response");
        res.writeHead(400, {
          "Content-Type": "application/json",
          Connection: "close",
        });
        res.end(JSON.stringify(result));
        console.log("Response sent successfully");
      }
      return;
    } else {
      console.log("Using production mode for seed upload");
    }

    // Submit job with validation (for production)
    // Dynamically import only in non-test mode
    if (process.env.NODE_ENV !== "test") {
      if (!submitJobWithValidation) {
        ({ submitJobWithValidation } = await import("../api/index.js"));
      }
      const result = await submitJobWithValidation({
        dataDir: currentDataDir,
        seedObject,
      });

      // Send appropriate response
      if (result.success) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));

        // Broadcast SSE event for successful upload
        sseRegistry.broadcast({
          type: "seed:uploaded",
          data: { name: result.jobName },
        });
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }
    } else {
      // In test mode, we should never reach here, but handle gracefully
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message:
            "Test environment error - should not reach production code path",
        })
      );
    }
  } catch (error) {
    console.error("Upload error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        message: "Internal server error",
      })
    );
  }
}

// MIME type detection map
const MIME_MAP = {
  // Text types
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".conf": "text/plain",
  ".config": "text/plain",
  ".env": "text/plain",
  ".gitignore": "text/plain",
  ".dockerfile": "text/plain",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".fish": "application/x-fish",
  ".ps1": "application/x-powershell",
  ".bat": "application/x-bat",
  ".cmd": "application/x-cmd",

  // Code types
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "application/typescript",
  ".mts": "application/typescript",
  ".cts": "application/typescript",
  ".jsx": "application/javascript",
  ".tsx": "application/typescript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".php": "application/x-php",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".cc": "text/x-c++",
  ".cxx": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".swift": "text/x-swift",
  ".kt": "text/x-kotlin",
  ".scala": "text/x-scala",
  ".r": "text/x-r",
  ".sql": "application/sql",
  ".pl": "text/x-perl",
  ".lua": "text/x-lua",
  ".vim": "text/x-vim",
  ".el": "text/x-elisp",
  ".lisp": "text/x-lisp",
  ".hs": "text/x-haskell",
  ".ml": "text/x-ocaml",
  ".ex": "text/x-elixir",
  ".exs": "text/x-elixir",
  ".erl": "text/x-erlang",
  ".beam": "application/x-erlang-beam",

  // Web types
  ".html": "text/html",
  ".htm": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".sass": "text/x-sass",
  ".less": "text/x-less",
  ".styl": "text/x-stylus",
  ".vue": "text/x-vue",
  ".svelte": "text/x-svelte",

  // Data formats
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".psd": "image/vnd.adobe.photoshop",
  ".ai": "application/pdf", // Illustrator files often saved as PDF
  ".eps": "application/postscript",

  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma",

  // Video
  ".mp4": "video/mp4",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",

  // Archives
  ".zip": "application/zip",
  ".rar": "application/x-rar-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".xz": "application/x-xz",
  ".7z": "application/x-7z-compressed",
  ".deb": "application/x-debian-package",
  ".rpm": "application/x-rpm",
  ".dmg": "application/x-apple-diskimage",
  ".iso": "application/x-iso9660-image",

  // Fonts
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".eot": "application/vnd.ms-fontobject",

  // Misc
  ".bin": "application/octet-stream",
  ".exe": "application/x-msdownload",
  ".dll": "application/x-msdownload",
  ".so": "application/x-sharedlib",
  ".dylib": "application/x-mach-binary",
  ".class": "application/java-vm",
  ".jar": "application/java-archive",
  ".war": "application/java-archive",
  ".ear": "application/java-archive",
  ".apk": "application/vnd.android.package-archive",
  ".ipa": "application/x-itunes-ipa",
};

/**
 * Determine MIME type from file extension
 * @param {string} filename - File name
 * @returns {string} MIME type
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Check if MIME type should be treated as text
 * @param {string} mime - MIME type
 * @returns {boolean} True if text-like
 */
function isTextMime(mime) {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime === "application/x-sh" ||
    mime === "application/x-bat" ||
    mime === "application/x-cmd" ||
    mime === "application/x-powershell" ||
    mime === "image/svg+xml" ||
    mime === "application/x-ndjson" ||
    mime === "text/csv" ||
    mime === "text/markdown"
  );
}

/**
 * Handle task file list request with validation and security checks
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 * @param {Object} params - Request parameters
 */
async function handleTaskFileListRequest(req, res, { jobId, taskId, type }) {
  const dataDir = process.env.PO_ROOT || DATA_DIR;

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
 * Consolidated path jail security validation with generic error messages
 * @param {string} filename - Filename to validate
 * @returns {Object|null} Validation result or null if valid
 */
function validateFilePath(filename) {
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
 * Handle task file request with validation, jail checks, and proper encoding
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 * @param {Object} params - Request parameters
 */
async function handleTaskFileRequest(
  req,
  res,
  { jobId, taskId, type, filename }
) {
  const dataDir = process.env.PO_ROOT || DATA_DIR;

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

/**
 * Serve static files from dist directory (built React app)
 */
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(content);
    }
  });
}

/**
 * Create and start the HTTP server
 */
function createServer() {
  console.log("Creating HTTP server...");
  const server = http.createServer(async (req, res) => {
    // Use WHATWG URL API instead of deprecated url.parse
    const { pathname, searchParams } = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    // DEBUG: Log all API requests
    if (pathname.startsWith("/api/")) {
      console.log(`DEBUG: API Request: ${req.method} ${pathname}`);
    }

    // CORS headers for API endpoints
    if (pathname.startsWith("/api/")) {
      // Important for tests: avoid idle keep-alive sockets on short API calls
      res.setHeader("Connection", "close");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Route: GET /api/jobs/:jobId/tasks/:taskId/costs (must come before ALL other job routes)
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/costs") &&
      req.method === "GET"
    ) {
      console.log(
        `DEBUG: Task costs endpoint matched for pathname: ${pathname}`
      );
      console.log(`DEBUG: Method check: ${req.method === "GET"}`);
      console.log(
        `DEBUG: Path starts check: ${pathname.startsWith("/api/jobs/")}`
      );
      console.log(
        `DEBUG: Path includes check: ${pathname.includes("/tasks/")}`
      );
      console.log(`DEBUG: Path ends check: ${pathname.endsWith("/costs")}`);
      const pathMatch = pathname.match(
        /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/costs$/
      );
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId, taskId] = pathMatch;

      try {
        // Get raw job data instead of transformed data to preserve tokenUsage
        const { readJob } = await import("./job-reader.js");
        const rawResult = await readJob(process.env.PO_ROOT || DATA_DIR, jobId);

        console.log(
          `DEBUG: Raw job result:`,
          rawResult.ok ? "success" : "failed"
        );

        if (!rawResult.ok) {
          switch (rawResult.code) {
            case "job_not_found":
              sendJson(res, 404, rawResult);
              break;
            case "bad_request":
              sendJson(res, 400, rawResult);
              break;
            default:
              sendJson(res, 500, rawResult);
          }
          return;
        }

        // Check if task exists in raw job data
        const rawJobData = rawResult.data;
        if (!rawJobData.tasks?.[taskId]) {
          sendJson(res, 404, {
            ok: false,
            code: "task_not_found",
            message: "Task not found",
            taskId,
          });
          return;
        }

        console.log(
          `DEBUG: Raw task data for ${taskId}:`,
          JSON.stringify(rawJobData.tasks[taskId], null, 2)
        );

        // Calculate costs from raw data to preserve tokenUsage
        const { calculateJobCosts, formatCostDataForAPI } = await import(
          "../utils/token-cost-calculator.js"
        );

        const costs = calculateJobCosts(rawJobData, taskId);
        const formattedCosts = formatCostDataForAPI(costs);

        console.log(
          `DEBUG: Calculated costs for ${taskId}:`,
          JSON.stringify(costs.tasksLevel?.[taskId], null, 2)
        );

        // Extract just the specific task cost data
        const taskCostData = formattedCosts.taskBreakdown?.[taskId] || {
          summary: {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalCost: 0,
            modelBreakdown: {},
          },
          entries: [],
        };

        sendJson(res, 200, {
          ok: true,
          data: {
            jobId,
            taskId,
            costs: taskCostData,
          },
        });
      } catch (error) {
        console.error(
          `Error handling /api/jobs/${jobId}/tasks/${taskId}/costs:`,
          error
        );
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/state
    if (pathname === "/api/state") {
      if (req.method !== "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Method not allowed",
            allowed: ["GET"],
          })
        );
        return;
      }

      // Prefer returning the in-memory state when available (tests and runtime rely on state.getState()).
      // If in-memory state is available, return it directly; otherwise fall back to
      // building a filesystem-backed snapshot for client bootstrap.
      try {
        try {
          if (state && typeof state.getState === "function") {
            const inMemory = state.getState();
            if (inMemory) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(inMemory));
              return;
            }
          }
        } catch (innerErr) {
          // If reading in-memory state throws for some reason, fall back to snapshot
          console.warn(
            "Warning: failed to retrieve in-memory state:",
            innerErr
          );
        }

        // Build a filesystem-backed snapshot for client bootstrap.
        // Dynamically import the composer and dependencies to avoid circular import issues.
        const [
          { buildSnapshotFromFilesystem },
          jobScannerModule,
          jobReaderModule,
          statusTransformerModule,
          configBridgeModule,
        ] = await Promise.all([
          import("./state-snapshot.js"),
          import("./job-scanner.js").catch(() => null),
          import("./job-reader.js").catch(() => null),
          import("./transformers/status-transformer.js").catch(() => null),
          import("./config-bridge.js").catch(() => null),
        ]);

        const snapshot = await buildSnapshotFromFilesystem({
          listAllJobs:
            jobScannerModule && jobScannerModule.listAllJobs
              ? jobScannerModule.listAllJobs
              : undefined,
          readJob:
            jobReaderModule && jobReaderModule.readJob
              ? jobReaderModule.readJob
              : undefined,
          transformMultipleJobs:
            statusTransformerModule &&
            statusTransformerModule.transformMultipleJobs
              ? statusTransformerModule.transformMultipleJobs
              : undefined,
          now: () => new Date(),
          paths: (configBridgeModule && configBridgeModule.PATHS) || undefined,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        console.error("Failed to build /api/state snapshot:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            code: "snapshot_error",
            message: "Failed to build state snapshot",
            details: err && err.message ? err.message : String(err),
          })
        );
      }

      return;
    }

    // Route: GET /api/events (SSE)
    if (
      (pathname === "/api/events" || pathname === "/api/sse") &&
      req.method === "GET"
    ) {
      // Parse jobId from query parameters for filtering
      const jobId = searchParams.get("jobId");

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Flush headers immediately
      res.flushHeaders();

      // Initial full-state is no longer sent over the SSE stream.
      // Clients should fetch the snapshot from GET /api/state during bootstrap
      // and then rely on SSE incremental events (state:change/state:summary).
      // Keep headers flushed; sseRegistry.addClient will optionally send an initial ping.
      // (Previously sent full state here; removed to reduce SSE payloads.)

      // Add to SSE registry with jobId metadata for filtering
      sseRegistry.addClient(res, { jobId });

      // Start heartbeat for this connection
      const heartbeatInterval = setInterval(() => {
        try {
          res.write(
            `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
          );
        } catch (err) {
          // Client disconnected, stop heartbeat
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Remove client on disconnect
      req.on("close", () => {
        clearInterval(heartbeatInterval);
        sseRegistry.removeClient(res);
      });

      return;
    }

    // Route: POST /api/upload/seed
    if (pathname === "/api/upload/seed") {
      if (req.method !== "POST") {
        return sendJson(res, 405, {
          success: false,
          error: "Method not allowed",
          allowed: ["POST"],
        });
      }

      // Use the handleSeedUpload function which properly parses multipart data
      await handleSeedUpload(req, res);
      return;
    }

    // Route: GET /api/jobs/:jobId/tasks/:taskId/files (must come before generic /api/jobs/:jobId)
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/files") &&
      req.method === "GET"
    ) {
      const pathMatch = pathname.match(
        /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/files$/
      );
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId, taskId] = pathMatch;
      const type = searchParams.get("type");

      // Validate parameters
      if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "jobId is required",
        });
        return;
      }

      if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "taskId is required",
        });
        return;
      }

      if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "type must be one of: artifacts, logs, tmp",
        });
        return;
      }

      try {
        await handleTaskFileListRequest(req, res, {
          jobId,
          taskId,
          type,
        });
      } catch (error) {
        console.error(`Error handling task file list request:`, error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/jobs/:jobId/tasks/:taskId/file (must come before generic /api/jobs/:jobId)
    if (
      pathname.startsWith("/api/jobs/") &&
      pathname.includes("/tasks/") &&
      pathname.endsWith("/file") &&
      req.method === "GET"
    ) {
      const pathMatch = pathname.match(
        /^\/api\/jobs\/([^\/]+)\/tasks\/([^\/]+)\/file$/
      );
      if (!pathMatch) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Invalid path format",
        });
        return;
      }

      const [, jobId, taskId] = pathMatch;
      const type = searchParams.get("type");
      const filename = searchParams.get("filename");

      // Validate parameters
      if (!jobId || typeof jobId !== "string" || jobId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "jobId is required",
        });
        return;
      }

      if (!taskId || typeof taskId !== "string" || taskId.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "taskId is required",
        });
        return;
      }

      if (!type || !["artifacts", "logs", "tmp"].includes(type)) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "type must be one of: artifacts, logs, tmp",
        });
        return;
      }

      if (!filename || typeof filename !== "string" || filename.trim() === "") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "filename is required",
        });
        return;
      }

      try {
        await handleTaskFileRequest(req, res, {
          jobId,
          taskId,
          type,
          filename,
        });
      } catch (error) {
        console.error(`Error handling task file request:`, error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/jobs
    if (pathname === "/api/jobs" && req.method === "GET") {
      try {
        const result = await handleJobList();

        if (result.ok) {
          sendJson(res, 200, result.data);
        } else {
          sendJson(res, 500, result);
        }
      } catch (error) {
        console.error("Error handling /api/jobs:", error);
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Route: GET /api/llm/functions
    if (pathname === "/api/llm/functions" && req.method === "GET") {
      try {
        const { getConfig } = await import("../core/config.js");
        const config = getConfig();

        // Helper to convert model alias to camelCase function name
        const toCamelCase = (alias) => {
          const [provider, ...modelParts] = alias.split(":");
          const model = modelParts.join("-");
          const camelModel = model.replace(/-([a-z0-9])/g, (match, char) =>
            char.toUpperCase()
          );
          return camelModel;
        };

        // Filter for deepseek, openai only (no gemini provider exists)
        const targetProviders = ["deepseek", "openai"];
        const functions = {};

        for (const [alias, modelConfig] of Object.entries(config.llm.models)) {
          const { provider } = modelConfig;
          if (!targetProviders.includes(provider)) continue;

          if (!functions[provider]) {
            functions[provider] = [];
          }

          const functionName = toCamelCase(alias);
          functions[provider].push({
            alias,
            functionName,
            fullPath: `llm.${provider}.${functionName}`,
            model: modelConfig.model,
          });
        }

        sendJson(res, 200, functions);
      } catch (error) {
        console.error("Error handling /api/llm/functions:", error);
        sendJson(res, 500, {
          ok: false,
          error: "internal_error",
          message: "Failed to get LLM functions",
        });
      }
      return;
    }

    // Route: GET /api/jobs/:jobId
    if (pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const jobId = pathname.substring("/api/jobs/".length);

      try {
        const result = await handleJobDetail(jobId);

        if (result.ok) {
          sendJson(res, 200, result);
        } else {
          switch (result.code) {
            case "job_not_found":
              sendJson(res, 404, result);
              break;
            case "bad_request":
              sendJson(res, 400, result);
              break;
            default:
              sendJson(res, 500, result);
          }
        }
      } catch (error) {
        console.error(`Error handling /api/jobs/${jobId}:`, error);
        sendJson(res, 500, {
          ok: false,
          code: "internal_error",
          message: "Internal server error",
        });
      }
      return;
    }

    // Unknown API endpoint fallback (keep API responses in JSON)
    if (pathname.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Not found",
          path: pathname,
          method: req.method,
        })
      );
      return;
    }

    // Prefer Vite middleware in development for non-API routes (HMR & asset serving)
    if (viteServer && viteServer.middlewares) {
      try {
        // Let Vite handle all non-API requests (including assets). If Vite calls next,
        // fall back to the static handlers below.
        return viteServer.middlewares(req, res, () => {
          if (pathname === "/" || pathname === "/index.html") {
            serveStatic(res, path.join(__dirname, "dist", "index.html"));
          } else if (pathname.startsWith("/assets/")) {
            const assetPath = pathname.substring(1); // Remove leading slash
            serveStatic(res, path.join(__dirname, "dist", assetPath));
          } else if (pathname.startsWith("/public/")) {
            const publicPath = pathname.substring(1); // Remove leading slash
            serveStatic(
              res,
              path.join(__dirname, "public", publicPath.replace("public/", ""))
            );
          } else {
            // Fallback to index.html for client-side routing
            serveStatic(res, path.join(__dirname, "dist", "index.html"));
          }
        });
      } catch (err) {
        console.error("Vite middleware error:", err);
        // Fallback to serving built assets
        serveStatic(res, path.join(__dirname, "dist", "index.html"));
      }
    } else {
      // No Vite dev server available; serve static files from dist/public as before
      if (pathname === "/" || pathname === "/index.html") {
        serveStatic(res, path.join(__dirname, "dist", "index.html"));
      } else if (pathname.startsWith("/assets/")) {
        // Serve assets from dist/assets
        const assetPath = pathname.substring(1); // Remove leading slash
        serveStatic(res, path.join(__dirname, "dist", assetPath));
      } else if (pathname.startsWith("/public/")) {
        // Serve static files from public directory
        const publicPath = pathname.substring(1); // Remove leading slash
        serveStatic(
          res,
          path.join(__dirname, "public", publicPath.replace("public/", ""))
        );
      } else {
        // For any other route, serve the React app's index.html
        // This allows client-side routing to work
        serveStatic(res, path.join(__dirname, "dist", "index.html"));
      }
    }
  });

  return server;
}

/**
 * Initialize file watcher
 */
let watcher = null;

function initializeWatcher() {
  // Require PO_ROOT for non-test runs
  const base = process.env.PO_ROOT;
  if (!base) {
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "ERROR: PO_ROOT environment variable is required for non-test runs"
      );
      throw new Error(
        "PO_ROOT environment variable is required for non-test runs"
      );
    } else {
      console.warn(
        "WARNING: PO_ROOT not set, using process.cwd() in test mode"
      );
    }
  }

  const effectiveBase = base || process.cwd();

  // Derive paths via resolvePipelinePaths to obtain absolute dirs for pipeline lifecycle directories
  const paths = resolvePipelinePaths(effectiveBase);

  // Build absolute paths array including pipeline-config and all lifecycle directories
  const absolutePaths = [
    path.join(effectiveBase, "pipeline-config"),
    paths.current,
    paths.complete,
    paths.pending,
    paths.rejected,
  ];

  // Log effective configuration
  console.log(`Watching directories under PO_ROOT=${effectiveBase}`);
  console.log("Final absolute paths:", absolutePaths);

  // Keep original WATCHED_PATHS in state for display/tests; watcher receives absolute paths.
  state.setWatchedPaths(WATCHED_PATHS);

  watcher = startWatcher(
    absolutePaths,
    (changes) => {
      // Update state for each change and capture the last returned state.
      // Prefer broadcasting the state returned by recordChange (if available)
      // to ensure tests and callers receive an up-to-date snapshot without
      // relying on mocked module-level getState behavior.
      let lastState = null;
      changes.forEach(({ path, type }) => {
        try {
          lastState = state.recordChange(path, type);
        } catch (err) {
          // Don't let a single change handler error prevent broadcasting
        }
      });

      // Broadcast updated state: prefer the result returned by recordChange when available
      broadcastStateUpdate(lastState || state.getState());
    },
    { baseDir: effectiveBase, debounceMs: 200 }
  );
}

/**
 * Start the server
 */
function start(customPort) {
  const port = customPort || PORT;
  const server = createServer();

  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Watching paths: ${WATCHED_PATHS.join(", ")}`);

    initializeWatcher();
    startHeartbeat();
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down gracefully...");

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watcher) await stopWatcher(watcher);

    sseRegistry.closeAll();

    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });

  return server;
}

/**
 * Start server with configurable data directory and port
 * @param {Object} options - Server options
 * @param {string} options.dataDir - Base data directory for pipeline data
 * @param {number} [options.port] - Optional port (defaults to PORT env var or 4000)
 * @returns {Promise<{url: string, close: function}>} Server instance with URL and close method
 */
async function startServer({ dataDir, port: customPort }) {
  try {
    console.log(
      "DEBUG: startServer called with dataDir:",
      dataDir,
      "customPort:",
      customPort
    );

    // Initialize config-bridge paths early to ensure consistent path resolution
    // This prevents path caching issues when dataDir changes between tests
    const { initPATHS } = await import("./config-bridge.node.js");
    initPATHS(dataDir);

    // Set the data directory environment variable
    if (dataDir) {
      process.env.PO_ROOT = dataDir;
    }

    // Require PO_ROOT for non-test runs
    if (!process.env.PO_ROOT) {
      if (process.env.NODE_ENV !== "test") {
        console.error(
          "ERROR: PO_ROOT environment variable is required for non-test runs"
        );
        throw new Error(
          "PO_ROOT environment variable is required for non-test runs"
        );
      } else {
        console.warn(
          "WARNING: PO_ROOT not set, using process.cwd() in test mode"
        );
        process.env.PO_ROOT = process.cwd();
      }
    }

    // Use customPort if provided, otherwise use PORT env var, otherwise use 0 for ephemeral port
    const port =
      customPort !== undefined
        ? customPort
        : process.env.PORT
          ? parseInt(process.env.PORT)
          : 0;

    console.log("DEBUG: About to create server...");

    // In development, start Vite in middlewareMode so the Node server can serve
    // the client with HMR in a single process. We dynamically import Vite here
    // to avoid including it in production bundles.
    // Skip Vite entirely for API-only tests when DISABLE_VITE=1 is set.
    // Do not start Vite in tests to avoid dep-scan errors during teardown.
    if (
      process.env.NODE_ENV === "development" &&
      process.env.DISABLE_VITE !== "1"
    ) {
      try {
        // Import createServer under an alias to avoid collision with our createServer()
        const { createServer: createViteServer } = await import("vite");
        viteServer = await createViteServer({
          root: path.join(__dirname, "client"),
          server: { middlewareMode: true },
          appType: "custom",
        });
        console.log("DEBUG: Vite dev server started (middleware mode)");
      } catch (err) {
        console.error("Failed to start Vite dev server:", err);
        viteServer = null;
      }
    } else if (process.env.NODE_ENV === "test") {
      console.log("DEBUG: Vite disabled in test mode (API-only mode)");
    } else if (process.env.DISABLE_VITE === "1") {
      console.log("DEBUG: Vite disabled via DISABLE_VITE=1 (API-only mode)");
    }

    const server = createServer();
    console.log("DEBUG: Server created successfully");

    // Robust promise with proper error handling and race condition prevention
    console.log(`Attempting to start server on port ${port}...`);
    await new Promise((resolve, reject) => {
      let settled = false;

      const errorHandler = (error) => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);

          // Enhance error with structured information for better test assertions
          if (error.code === "EADDRINUSE") {
            error.message = `Port ${port} is already in use`;
            error.port = port;
          }

          console.error(`Server error on port ${port}:`, error);
          reject(error);
        }
      };

      const successHandler = () => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);
          console.log(`Server successfully started on port ${port}`);
          resolve();
        }
      };

      // Attach error handler BEFORE attempting to listen
      server.on("error", errorHandler);

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.removeListener("error", errorHandler);
          reject(new Error(`Server startup timeout on port ${port}`));
        }
      }, 5000); // 5 second timeout

      server.listen(port, () => {
        clearTimeout(timeout);
        successHandler();
      });
    });

    const address = server.address();
    const baseUrl = `http://localhost:${address.port}`;

    console.log(`Server running at ${baseUrl}`);
    if (dataDir) {
      console.log(`Data directory: ${dataDir}`);
    }

    // Only initialize watcher and heartbeat in non-test environments
    if (process.env.NODE_ENV !== "test") {
      console.log(`Watching paths: ${WATCHED_PATHS.join(", ")}`);
      initializeWatcher();
      startHeartbeat();
    } else {
      console.log("Server started in test mode - skipping watcher/heartbeat");
    }

    return {
      url: baseUrl,
      close: async () => {
        // Clean up all resources
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        if (watcher) {
          await stopWatcher(watcher);
          watcher = null;
        }

        sseRegistry.closeAll();

        // Close Vite dev server if running (development single-process mode)
        if (viteServer && typeof viteServer.close === "function") {
          try {
            await viteServer.close();
            viteServer = null;
            console.log("DEBUG: Vite dev server closed");
          } catch (err) {
            console.error("Error closing Vite dev server:", err);
          }
        }

        // Close the HTTP server
        return new Promise((resolve) => server.close(resolve));
      },
    };
  } catch (error) {
    console.error("Failed to start server:", error);
    throw error; // Re-throw so tests can handle it
  }
}

// Export for testing
export {
  createServer,
  start,
  startServer,
  broadcastStateUpdate,
  sseRegistry,
  initializeWatcher,
  state,
  resolveJobLifecycle,
};

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
