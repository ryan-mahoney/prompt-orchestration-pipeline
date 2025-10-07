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
import { getPendingSeedPath, resolvePipelinePaths } from "../config/paths.js";
import { handleJobList, handleJobDetail } from "./endpoints/job-endpoints.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 4000;
const WATCHED_PATHS = (process.env.WATCHED_PATHS || "pipeline-config,runs")
  .split(",")
  .map((p) => p.trim());
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DATA_DIR = process.env.PO_ROOT || process.cwd();

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
  let partialFilePath = null;

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

    // Get the pending file path
    const pendingPath = getPendingSeedPath(dataDir, seedObject.name);
    partialFilePath = pendingPath;

    // Ensure the pending directory exists
    const paths = resolvePipelinePaths(dataDir);
    await fs.promises.mkdir(paths.pending, { recursive: true });

    // Check for duplicates
    try {
      await fs.promises.access(pendingPath);
      if (partialFilePath) {
        try {
          await fs.promises.unlink(partialFilePath);
        } catch {}
      }
      return {
        success: false,
        message: "Job with this name already exists",
      };
    } catch (error) {
      // File doesn't exist, continue
    }

    // Write to pending directory
    await fs.promises.writeFile(
      pendingPath,
      JSON.stringify(seedObject, null, 2)
    );

    return {
      success: true,
      jobName: seedObject.name,
      message: "Seed file uploaded successfully",
    };
  } catch (error) {
    // Clean up any partial files on failure
    if (partialFilePath) {
      try {
        await fs.promises.unlink(partialFilePath);
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
 * Send SSE message to a client
 */
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast state update to all SSE clients
 */
function broadcastStateUpdate(currentState) {
  sseRegistry.broadcast({
    type: "state",
    data: currentState,
  });
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.getState()));
      return;
    }

    // Route: GET /api/events (SSE)
    if (
      (pathname === "/api/events" || pathname === "/api/sse") &&
      req.method === "GET"
    ) {
      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Flush headers immediately
      res.flushHeaders();

      // Write initial state event immediately
      res.write(`event: state\ndata: ${JSON.stringify(state.getState())}\n\n`);

      // Add to SSE registry
      sseRegistry.addClient(res);

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

    // Route: GET /api/jobs/:jobId
    if (pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const jobId = pathname.substring("/api/jobs/".length);

      try {
        const result = await handleJobDetail(jobId);

        if (result.ok) {
          sendJson(res, 200, result.data);
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

    // Serve static files from dist directory (built React app)
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
  });

  return server;
}

/**
 * Initialize file watcher
 */
let watcher = null;

function initializeWatcher() {
  state.setWatchedPaths(WATCHED_PATHS);

  watcher = startWatcher(WATCHED_PATHS, (changes) => {
    // Update state for each change
    changes.forEach(({ path, type }) => {
      state.recordChange(path, type);
    });

    // Broadcast updated state
    broadcastStateUpdate(state.getState());
  });
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

    // Set the data directory environment variable
    if (dataDir) {
      process.env.PO_ROOT = dataDir;
    }

    // Use customPort if provided, otherwise use PORT env var, otherwise use 0 for ephemeral port
    const port =
      customPort !== undefined
        ? customPort
        : process.env.PORT
          ? parseInt(process.env.PORT)
          : 0;

    console.log("DEBUG: About to create server...");
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
};

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
