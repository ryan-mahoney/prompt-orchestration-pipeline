/**
 * Simple state manager for tracking file changes
 * Maintains an in-memory state with change history
 */

const MAX_RECENT_CHANGES = 10;

let state = {
  updatedAt: new Date().toISOString(),
  changeCount: 0,
  recentChanges: [],
  watchedPaths: [],
};

/**
 * Get the current state
 * @returns {Object} Current state object
 */
export function getState() {
  return { ...state };
}

/**
 * Record a file change event
 * @param {string} path - File path that changed
 * @param {string} type - Type of change: 'created', 'modified', or 'deleted'
 * @returns {Object} Updated state
 */
export function recordChange(path, type) {
  const timestamp = new Date().toISOString();

  // Add to recent changes (FIFO)
  const recentChanges = [
    { path, type, timestamp },
    ...state.recentChanges,
  ].slice(0, MAX_RECENT_CHANGES);

  // Update state
  state = {
    ...state,
    updatedAt: timestamp,
    changeCount: state.changeCount + 1,
    recentChanges,
  };

  return getState();
}

/**
 * Reset state to initial values
 */
export function reset() {
  state = {
    updatedAt: new Date().toISOString(),
    changeCount: 0,
    recentChanges: [],
    watchedPaths: state.watchedPaths, // Preserve watched paths
  };
}

/**
 * Set the paths being watched
 * @param {string[]} paths - Array of watched directory paths
 */
export function setWatchedPaths(paths) {
  state.watchedPaths = [...paths];
}
