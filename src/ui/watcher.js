/**
 * File watcher for monitoring pipeline directories
 * Provides real-time file change notifications
 */

import chokidar from "chokidar";
import path from "node:path";
import { detectJobChange } from "./job-change-detector.js";
import { sseEnhancer } from "./sse-enhancer.js";

/**
 * Normalize path separators to forward slash and trim
 * Reuses the same logic from job-change-detector
 */
function normalizePath(p) {
  if (!p || typeof p !== "string") return "";
  return p.replace(/\\/g, "/").replace(/\/\/+/g, "/");
}

/**
 * Start watching specified paths for file changes
 * @param {string[]} paths - Array of directory paths to watch
 * @param {Function} onChange - Callback function to handle file changes
 * @param {Object} options - Configuration options
 * @param {number} options.debounceMs - Debounce time in milliseconds (default: 200)
 * @param {string} options.baseDir - Base directory for path normalization (required)
 * @returns {Object} Watcher instance with close method
 */
export function start(paths, onChange, options = {}) {
  if (!options.baseDir) {
    throw new Error("options.baseDir is required");
  }

  const { baseDir, debounceMs = 200 } = options;
  let debounceTimer = null;
  let pendingChanges = [];

  // Initialize chokidar watcher
  const watcher = chokidar.watch(paths, {
    ignored: [
      /(^|[\/\\])(\.git|node_modules|dist)([\/\\]|$)/,
      /pipeline-data\/[^/]+\/[^/]+\/tasks\/[^/]+\/_task_root([\/\\]|$)/,
    ],
    followSymlinks: false,
    persistent: true,
    ignoreInitial: true,
  });

  // Debounced change handler
  const flushChanges = () => {
    if (pendingChanges.length > 0) {
      const changes = [...pendingChanges];
      pendingChanges = [];
      onChange(changes);
    }
  };

  const scheduleFlush = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushChanges, debounceMs);
  };

  // Handle file events
  watcher.on("add", async (rawPath) => {
    // Compute relative path from baseDir and normalize
    const rel = normalizePath(path.relative(baseDir, rawPath));
    // Always use relative path for consistency with tests
    const normalizedPath = rel;

    console.debug("[Watcher] File added:", normalizedPath);

    // Detect registry.json changes and reload config
    if (normalizedPath === "pipeline-config/registry.json") {
      console.log("[Watcher] registry.json added, reloading config...");
      try {
        const { resetConfig } = await import("../core/config.js");
        resetConfig();
        console.log("[Watcher] Config cache invalidated successfully");
      } catch (error) {
        console.error("[Watcher] Failed to reload config:", error);
      }
    }

    pendingChanges.push({ path: normalizedPath, type: "created" });
    scheduleFlush();

    // Check for job-specific changes with normalized path
    const jobChange = detectJobChange(normalizedPath);
    if (jobChange) {
      console.debug("[Watcher] Job change detected:", jobChange);
      sseEnhancer.handleJobChange(jobChange);
    }
  });

  watcher.on("change", async (rawPath) => {
    // Compute relative path from baseDir and normalize
    const rel = normalizePath(path.relative(baseDir, rawPath));
    // Always use relative path for consistency with tests
    const normalizedPath = rel;

    // Skip "modified" events for files under pipeline-data/.../files/
    // (logs etc. are frequently updated but frontend only cares about creation)
    if (/pipeline-data\/[^/]+\/[^/]+\/files\//.test(normalizedPath)) {
      console.debug("[Watcher] Skipping files/ modification:", normalizedPath);
      return;
    }

    console.debug("[Watcher] File changed:", normalizedPath);

    // Detect registry.json changes and reload config
    if (normalizedPath === "pipeline-config/registry.json") {
      console.log("[Watcher] registry.json modified, reloading config...");
      try {
        const { resetConfig } = await import("../core/config.js");
        resetConfig();
        console.log("[Watcher] Config cache invalidated successfully");
      } catch (error) {
        console.error("[Watcher] Failed to reload config:", error);
      }
    }

    pendingChanges.push({ path: normalizedPath, type: "modified" });
    scheduleFlush();

    // Check for job-specific changes with normalized path
    const jobChange = detectJobChange(normalizedPath);
    if (jobChange) {
      console.debug("[Watcher] Job change detected:", jobChange);
      sseEnhancer.handleJobChange(jobChange);
    }
  });

  watcher.on("unlink", (rawPath) => {
    // Compute relative path from baseDir and normalize
    const rel = normalizePath(path.relative(baseDir, rawPath));
    // Always use relative path for consistency with tests
    const normalizedPath = rel;

    pendingChanges.push({ path: normalizedPath, type: "deleted" });
    scheduleFlush();

    // Check for job-specific changes with normalized path
    const jobChange = detectJobChange(normalizedPath);
    if (jobChange) {
      sseEnhancer.handleJobChange(jobChange);
    }
  });

  // Return watcher with enhanced close method
  return {
    _chokidarWatcher: watcher,
    _debounceTimer: debounceTimer,
    close: async () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingChanges = [];
      await watcher.close();
    },
  };
}

/**
 * Stop watching files
 * @param {Object} watcher - Watcher instance to stop
 * @returns {Promise<void>}
 */
export async function stop(watcher) {
  if (!watcher) {
    return;
  }
  await watcher.close();
}
