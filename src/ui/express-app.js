import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { sseRegistry } from "./sse.js";
import { handleApiState } from "./endpoints/state-endpoint.js";
import { handleSeedUpload } from "./endpoints/upload-endpoints.js";
import {
  handleJobListRequest,
  handleJobDetailRequest,
} from "./endpoints/job-endpoints.js";
import {
  handleJobRescan,
  handleJobRestart,
  handleJobStop,
  handleTaskStart,
} from "./endpoints/job-control-endpoints.js";
import {
  handleTaskFileListRequest,
  handleTaskFileRequest,
} from "./endpoints/file-endpoints.js";
import { handlePipelinesHttpRequest } from "./endpoints/pipelines-endpoint.js";
import { handlePipelineTypeDetailRequest } from "./endpoints/pipeline-type-detail-endpoint.js";
import { sendJson } from "./utils/http-utils.js";
import { PROVIDER_FUNCTIONS } from "../config/models.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build Express application with API routes, SSE, and static serving
 * @param {Object} params - Configuration parameters
 * @param {string} params.dataDir - Base data directory
 * @param {Object} [params.viteServer] - Vite dev server instance (optional)
 * @returns {express.Application} Configured Express app
 */
export function buildExpressApp({ dataDir, viteServer }) {
  const app = express();

  // API guard middleware mounted on /api
  app.use("/api", (req, res, next) => {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    // Set Connection: close for non-SSE requests
    const isSSE = req.path === "/events" || req.path === "/sse";
    if (!isSSE) {
      res.setHeader("Connection", "close");
    }

    next();
  });

  // SSE routes
  app.get(["/api/events", "/api/sse"], (req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Flush headers if available
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const jobId = req.query.jobId;
    sseRegistry.addClient(res, { jobId });

    req.on("close", () => {
      sseRegistry.removeClient(res);
    });
  });

  // REST routes

  // GET /api/state
  app.get("/api/state", async (req, res) => {
    await handleApiState(req, res);
  });

  // POST /api/upload/seed
  app.post("/api/upload/seed", async (req, res) => {
    await handleSeedUpload(req, res);
  });

  // GET /api/llm/functions
  app.get("/api/llm/functions", (req, res) => {
    try {
      sendJson(res, 200, { ok: true, data: PROVIDER_FUNCTIONS });
    } catch (error) {
      console.error("Error serving LLM functions:", error);
      sendJson(res, 500, {
        ok: false,
        error: "internal_error",
        message: "Failed to load LLM functions",
      });
    }
  });

  // GET /api/pipelines
  app.get("/api/pipelines", async (req, res) => {
    await handlePipelinesHttpRequest(req, res);
  });

  // GET /api/pipelines/:slug
  app.get("/api/pipelines/:slug", async (req, res) => {
    await handlePipelineTypeDetailRequest(req, res);
  });

  // GET /api/jobs
  app.get("/api/jobs", async (req, res) => {
    await handleJobListRequest(req, res);
  });

  // GET /api/jobs/:jobId
  app.get("/api/jobs/:jobId", async (req, res) => {
    const { jobId } = req.params;
    await handleJobDetailRequest(req, res, jobId);
  });

  // POST /api/jobs/:jobId/rescan
  app.post("/api/jobs/:jobId/rescan", async (req, res) => {
    const { jobId } = req.params;
    await handleJobRescan(req, res, jobId, dataDir, sendJson);
  });

  // POST /api/jobs/:jobId/restart
  app.post("/api/jobs/:jobId/restart", async (req, res) => {
    const { jobId } = req.params;
    await handleJobRestart(req, res, jobId, dataDir, sendJson);
  });

  // POST /api/jobs/:jobId/stop
  app.post("/api/jobs/:jobId/stop", async (req, res) => {
    const { jobId } = req.params;
    await handleJobStop(req, res, jobId, dataDir, sendJson);
  });

  // POST /api/jobs/:jobId/tasks/:taskId/start
  app.post("/api/jobs/:jobId/tasks/:taskId/start", async (req, res) => {
    const { jobId, taskId } = req.params;
    await handleTaskStart(req, res, jobId, taskId, dataDir, sendJson);
  });

  // GET /api/jobs/:jobId/tasks/:taskId/files
  app.get("/api/jobs/:jobId/tasks/:taskId/files", async (req, res) => {
    const { jobId, taskId } = req.params;
    const { type } = req.query;
    await handleTaskFileListRequest(req, res, {
      jobId,
      taskId,
      type,
      dataDir,
    });
  });

  // GET /api/jobs/:jobId/tasks/:taskId/file
  app.get("/api/jobs/:jobId/tasks/:taskId/file", async (req, res) => {
    const { jobId, taskId } = req.params;
    const { type, filename } = req.query;
    await handleTaskFileRequest(req, res, {
      jobId,
      taskId,
      type,
      filename,
      dataDir,
    });
  });

  // Dev middleware (mount after all API routes)
  if (viteServer && viteServer.middlewares) {
    app.use(viteServer.middlewares);
  } else {
    // Production static serving
    app.use("/public", express.static(path.join(__dirname, "public")));
    app.use("/assets", express.static(path.join(__dirname, "dist", "assets")));
    app.use(express.static(path.join(__dirname, "dist")));

    // SPA fallback
    app.get("*", (_, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  return app;
}
