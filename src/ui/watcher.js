/**
 * File watcher for monitoring pipeline directories
 * Provides real-time file change notifications
 */

import chokidar from "chokidar";

/**
 * Start watching specified paths for file changes
 * @param {string[]} paths - Array of directory paths to watch
 * @param {Function} onChange - Callback function to handle file changes
 * @param {Object} options - Configuration options
 * @param {number} options.debounceMs - Debounce time in milliseconds (default: 200)
 * @returns {Object} Watcher instance with close method
 */
export function start(paths, onChange, options = {}) {
  const debounceMs = options.debounceMs || 200;
  let debounceTimer = null;
  let pendingChanges = [];

  // Initialize chokidar watcher
  const watcher = chokidar.watch(paths, {
    ignored: /(^|[\/\\])(\.git|node_modules|dist)([\/\\]|$)/,
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
  watcher.on("add", (path) => {
    pendingChanges.push({ path, type: "created" });
    scheduleFlush();
  });

  watcher.on("change", (path) => {
    pendingChanges.push({ path, type: "modified" });
    scheduleFlush();
  });

  watcher.on("unlink", (path) => {
    pendingChanges.push({ path, type: "deleted" });
    scheduleFlush();
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
