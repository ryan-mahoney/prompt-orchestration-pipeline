import path from "node:path";

import { getConfig } from "../../core/config";
import { loadEnvironment } from "../../core/environment";
import { getConcurrencyRuntimePaths } from "../../core/job-concurrency";
import { createLogger } from "../../core/logger";
import * as state from "../state";
import type { JobChange, WatcherHandle, WatcherOptions } from "../state/types";
import { startWatcher } from "../state/watcher";
import { getState } from "../state/change-tracker";
import { broadcastStateUpdate } from "./sse-broadcast";
import { initPATHS, resolvePipelinePaths } from "./config-bridge-node";
import { createRouter } from "./router";
import { sseEnhancer } from "./sse-enhancer";
import { sseRegistry } from "./sse-registry";

const logger = createLogger("ui-server");

export interface ServerOptions {
  dataDir: string;
  port?: number;
}

export interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

let activeWatcher: WatcherHandle | null = null;

interface WatcherInternals extends WatcherOptions {
  __routeJobChange?: (change: JobChange) => Promise<void> | void;
}

export async function initializeWatcher(dataDir: string): Promise<void> {
  const paths = resolvePipelinePaths(dataDir);
  const runtime = getConcurrencyRuntimePaths(path.join(dataDir, "pipeline-data"));
  const orchestrator = getConfig().orchestrator;
  const watcherOptions: WatcherOptions & WatcherInternals = {
    baseDir: dataDir,
    debounceMs: orchestrator.watchDebounce,
    stabilityThresholdMs: orchestrator.watchStabilityThreshold,
    pollIntervalMs: orchestrator.watchPollInterval,
    __routeJobChange(change: JobChange) {
      if (change.filePath.endsWith("tasks-status.json")) {
        sseEnhancer.handleJobChange(change);
      }
    },
  };
  activeWatcher = startWatcher(
    [paths.current, paths.complete, paths.pending, runtime.runningJobsDir],
    async () => {
      broadcastStateUpdate(getState());
    },
    watcherOptions,
  );
}

export function createServer(dataDir?: string): { fetch: (req: Request) => Promise<Response> } {
  const resolvedDataDir = dataDir ?? process.env["PO_ROOT"] ?? process.cwd();
  const router = createRouter({ dataDir: resolvedDataDir, distDir: path.join(import.meta.dir, "../dist") });
  return { fetch: (req: Request) => router.handle(req) };
}

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  if (process.env["NODE_ENV"] !== "test" && !process.env["PO_ROOT"]) {
    throw new Error("PO_ROOT is required in non-test environments");
  }

  await loadEnvironment({ rootDir: options.dataDir });
  initPATHS(options.dataDir);

  const port = options.port ?? 4000;
  const app = createServer(options.dataDir);

  let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
    sseRegistry.broadcast("heartbeat", { ok: true, timestamp: new Date().toISOString() });
  }, 30_000);

  let server: Bun.Server<undefined> | null = null;
  try {
    server = Bun.serve({
      port,
      idleTimeout: 255, // max value – prevents Bun from closing long-lived SSE streams
      fetch: app.fetch,
      error(error) {
        logger.error("request failed", error);
        return new Response(JSON.stringify({ ok: false, code: "FS_ERROR", message: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    throw error;
  }

  const startup = Promise.race([
    Promise.resolve(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("server startup timed out after 5 seconds")), 5_000)),
  ]);
  await startup;
  await initializeWatcher(options.dataDir);

  return {
    url: `http://localhost:${port}`,
    async close() {
      const steps = [
        async () => {
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
        },
        async () => {
          await activeWatcher?.close();
          activeWatcher = null;
        },
        async () => {
          sseRegistry.closeAll();
        },
        async () => {
          sseEnhancer.cleanup();
        },
        async () => {
          server?.stop();
        },
      ];

      for (const step of steps) {
        try {
          await step();
        } catch (error) {
          logger.error("shutdown step failed", error);
        }
      }
    },
  };
}

export { sseRegistry } from "./sse-registry";
export { broadcastStateUpdate } from "./sse-broadcast";
export { state };

// Start server if run directly
if (
  process.argv[1] &&
  process.argv[1] !== process.execPath &&
  import.meta.url === Bun.pathToFileURL(process.argv[1]).href
) {
  const dataDir = process.env["PO_ROOT"] ?? process.cwd();
  startServer({ dataDir }).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
