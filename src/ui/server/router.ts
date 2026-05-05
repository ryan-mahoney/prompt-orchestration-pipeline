import path from "node:path";

import { embeddedAssets } from "./embedded-assets";
import { handleConcurrencyStatus } from "./endpoints/concurrency-endpoint";
import { handleCreatePipeline } from "./endpoints/create-pipeline-endpoint";
import { handleTaskFile, handleTaskFileList } from "./endpoints/file-endpoints";
import {
  handleJobRescan,
  handleJobRestart,
  handleJobStop,
  handleTaskStart,
} from "./endpoints/job-control-endpoints";
import { handleJobDetail, handleJobList } from "./endpoints/job-endpoints";
import { handlePipelineAnalysis } from "./endpoints/pipeline-analysis-endpoint";
import { handlePipelineArtifacts } from "./endpoints/pipeline-artifacts-endpoint";
import { handlePipelinesList } from "./endpoints/pipelines-endpoint";
import { handlePipelineTypeDetail } from "./endpoints/pipeline-type-detail-endpoint";
import { handleSchemaFile } from "./endpoints/schema-file-endpoint";
import { handleApiState } from "./endpoints/state-endpoint";
import { handleTaskAnalysis } from "./endpoints/task-analysis-endpoint";
import { handleTaskPlan } from "./endpoints/task-creation-endpoint";
import { handleTaskSave } from "./endpoints/task-save-endpoint";
import { handleSeedUpload } from "./endpoints/upload-endpoints";
import { handleSseEvents } from "./endpoints/sse-endpoints";
import { sendJson } from "./utils/http-utils";
import { getMimeType } from "./utils/mime-types";

type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: RouteHandler;
}

interface RouterOptions {
  dataDir: string;
  distDir?: string;
}

function normalizeParams(groups: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(groups).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function createRouter(options: RouterOptions): {
  addRoute(method: string, path: string, handler: RouteHandler): void;
  handle(req: Request): Promise<Response>;
} {
  const routes: Route[] = [];
  const distDir = options.distDir ?? path.join(process.cwd(), "dist");

  const addRoute = (method: string, routePath: string, handler: RouteHandler): void => {
    routes.push({ method, pattern: new URLPattern({ pathname: routePath }), handler });
  };

  const serveAsset = async (pathname: string): Promise<Response | null> => {
    const embedded = embeddedAssets[pathname];
    if (embedded) {
      return new Response(Bun.file(embedded.path), { headers: { "Content-Type": embedded.mime } });
    }

    const diskPath = pathname === "/" ? path.join(distDir, "index.html") : path.join(distDir, pathname);
    if (await Bun.file(diskPath).exists()) {
      return new Response(Bun.file(diskPath), { headers: { "Content-Type": getMimeType(diskPath) } });
    }

    const indexPath = path.join(distDir, "index.html");
    if (await Bun.file(indexPath).exists()) {
      return new Response(Bun.file(indexPath), { headers: { "Content-Type": "text/html" } });
    }

    return null;
  };

  addRoute("GET", "/api/jobs", () => handleJobList());
  addRoute("GET", "/api/jobs/:jobId", (_req, params) => handleJobDetail(params["jobId"]!));
  addRoute("POST", "/api/jobs/:jobId/restart", (req, params) => handleJobRestart(req, params["jobId"]!, options.dataDir));
  addRoute("POST", "/api/jobs/:jobId/stop", (req, params) => handleJobStop(req, params["jobId"]!, options.dataDir));
  addRoute("POST", "/api/jobs/:jobId/rescan", (req, params) => handleJobRescan(req, params["jobId"]!, options.dataDir));
  addRoute("POST", "/api/jobs/:jobId/tasks/:taskId/start", (req, params) => handleTaskStart(req, params["jobId"]!, params["taskId"]!, options.dataDir));
  addRoute("GET", "/api/jobs/:jobId/tasks/:taskId/files", (req, params) => handleTaskFileList(req, params["jobId"]!, params["taskId"]!));
  addRoute("GET", "/api/jobs/:jobId/tasks/:taskId/file", (req, params) => handleTaskFile(req, params["jobId"]!, params["taskId"]!));
  addRoute("GET", "/api/pipelines", () => handlePipelinesList());
  addRoute("GET", "/api/pipelines/:slug", (_req, params) => handlePipelineTypeDetail(params["slug"]!));
  addRoute("POST", "/api/pipelines", (req) => handleCreatePipeline(req));
  addRoute("POST", "/api/pipelines/:slug/analyze", (req, params) => handlePipelineAnalysis(req, params["slug"]!));
  addRoute("GET", "/api/pipelines/:slug/artifacts", (req, params) => handlePipelineArtifacts(req, params["slug"]!));
  addRoute("GET", "/api/pipelines/:slug/tasks/:taskId/analysis", (req, params) => handleTaskAnalysis(req, params["slug"]!, params["taskId"]!));
  addRoute("GET", "/api/pipelines/:slug/schemas/:filename", (req, params) => handleSchemaFile(req, params["slug"]!, params["filename"]!));
  addRoute("POST", "/api/ai/task-plan", (req) => handleTaskPlan(req));
  addRoute("POST", "/api/tasks/create", (req) => handleTaskSave(req));
  addRoute("GET", "/api/state", () => handleApiState());
  addRoute("GET", "/api/concurrency", () => handleConcurrencyStatus(options.dataDir));
  addRoute("GET", "/api/events", (req) => handleSseEvents(req));
  addRoute("GET", "/api/sse", (req) => handleSseEvents(req));
  addRoute("POST", "/api/upload/seed", (req) => handleSeedUpload(req, options.dataDir));

  return {
    addRoute,
    async handle(req) {
      const url = new URL(req.url);

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.pattern.exec(url);
        if (!match) continue;
        return route.handler(req, normalizeParams(match.pathname.groups));
      }

      const asset = await serveAsset(url.pathname);
      if (asset) return asset;
      return sendJson(404, { ok: false, code: "NOT_FOUND", message: "route not found" });
    },
  };
}
