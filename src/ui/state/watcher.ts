import path from "node:path";

import chokidar from "chokidar";

import { createLogger } from "../../core/logger";
import { recordChange, setWatchedPaths } from "./change-tracker";
import { detectJobChange } from "./job-change-detector";
import type {
  ChangeEntry,
  ChangeType,
  JobChange,
  WatcherHandle,
  WatcherOnChange,
  WatcherOptions,
} from "./types";

type ChokidarLike = {
  on(event: "ready", listener: () => void): ChokidarLike;
  on(event: string, listener: (filePath: string) => void): ChokidarLike;
  close(): Promise<void>;
};

interface WatcherInternals {
  __watchFactory?: (paths: string[], options: Record<string, unknown>) => ChokidarLike;
  __routeJobChange?: (change: JobChange) => Promise<void> | void;
  __resetConfig?: () => Promise<void> | void;
}

const IGNORED_PATHS = /(^|[\\/])(\.git|node_modules|dist|_task_root)([\\/]|$)|[\\/]runtime[\\/]lock([\\/]|$)/;

function toChangeType(event: string): ChangeType | null {
  if (event === "add") return "created";
  if (event === "change") return "modified";
  if (event === "unlink") return "deleted";
  return null;
}

function normalizePath(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).replaceAll("\\", "/");
}

function shouldSkip(changeType: ChangeType, normalizedPath: string): boolean {
  return (
    changeType === "modified" &&
    /^pipeline-data\/(?:current|complete|pending|rejected)\/[^/]+\/files\//.test(normalizedPath)
  );
}

async function routeJobChanges(
  batch: ChangeEntry[],
  routeJobChange?: (change: JobChange) => Promise<void> | void,
): Promise<void> {
  const route = routeJobChange ?? (async (change: JobChange) => {
    const enhancerPath = "../server/sse-enhancer";
    const enhancer = (await import(/* @vite-ignore */ enhancerPath)) as {
      routeJobChange?: (jobChange: JobChange) => Promise<void> | void;
    };
    await enhancer.routeJobChange?.(change);
  });

  for (const entry of batch) {
    const change = detectJobChange(entry.path);
    if (change) await route(change);
  }
}

async function reloadRegistry(
  batch: ChangeEntry[],
  resetConfigImpl?: () => Promise<void> | void,
): Promise<void> {
  const needsReload = batch.some(
    (entry) =>
      entry.type !== "deleted" && entry.path === "pipeline-config/registry.json",
  );
  if (!needsReload) return;

  const resetConfig =
    resetConfigImpl ??
    (async () => {
      const configModule = await import("../../core/config");
      configModule.resetConfig();
    });
  await resetConfig();
}

export function startWatcher(
  paths: string[],
  onChange: WatcherOnChange,
  options: WatcherOptions,
): WatcherHandle {
  if (!options.baseDir) {
    throw new Error("watcher requires options.baseDir");
  }

  const logger = createLogger("ui-state-watcher");
  const debounceMs = options.debounceMs ?? 200;
  const internals = options as WatcherOptions & WatcherInternals;
  const watchFactory = internals.__watchFactory ?? ((watchPaths, watchOptions) => chokidar.watch(watchPaths, watchOptions));

  let pending: ChangeEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    timer = null;
    if (batch.length === 0) return;

    try {
      await onChange(batch);
    } catch (error) {
      logger.error("watcher onChange failed", error);
    }

    try {
      await routeJobChanges(batch, internals.__routeJobChange);
    } catch (error) {
      logger.error("watcher job routing failed", error);
    }

    try {
      await reloadRegistry(batch, internals.__resetConfig);
    } catch (error) {
      logger.error("watcher config reload failed", error);
    }
  };

  const scheduleFlush = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, debounceMs);
  };

  const handleEvent = (event: string, filePath: string): void => {
    const changeType = toChangeType(event);
    if (!changeType) return;
    if (IGNORED_PATHS.test(filePath)) return;

    const normalizedPath = normalizePath(options.baseDir, filePath);
    if (shouldSkip(changeType, normalizedPath)) return;

    const change = recordChange(normalizedPath, changeType);
    pending.push(change);
    scheduleFlush();
  };

  setWatchedPaths(paths);

  const stabilityThresholdMs = options.stabilityThresholdMs;
  const pollIntervalMs = options.pollIntervalMs;
  const awaitWriteFinish =
    stabilityThresholdMs !== undefined && pollIntervalMs !== undefined
      ? { stabilityThreshold: stabilityThresholdMs, pollInterval: pollIntervalMs }
      : false;

  const watcher = watchFactory(paths, {
    ignored: IGNORED_PATHS,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish,
  });

  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => resolve());
  });

  watcher.on("add", (filePath) => handleEvent("add", filePath));
  watcher.on("change", (filePath) => handleEvent("change", filePath));
  watcher.on("unlink", (filePath) => handleEvent("unlink", filePath));

  return {
    ready,
    async close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}

export async function stopWatcher(watcher: WatcherHandle | null | undefined): Promise<void> {
  await watcher?.close();
}
