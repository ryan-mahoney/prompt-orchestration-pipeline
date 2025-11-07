/**
 * Global time store for efficient timer updates
 * Provides a single source of truth for time-based updates with dynamic cadence
 */

// Internal state
const offset = Date.now() - performance.now();
let currentNow = Math.floor(performance.now() + offset);
const listeners = new Set();
const cadenceHints = new Map();
let timerId = null;
let activeIntervalMs = 1000;
let isBackground = false;

/**
 * Subscribe to time updates
 * @param {Function} listener - Callback function called on each tick
 * @returns {Function} Unsubscribe function
 */
function subscribe(listener) {
  listeners.add(listener);

  // If this is the first listener, start the timer
  if (listeners.size === 1) {
    startTimer();
  }

  // Return unsubscribe function
  return () => {
    listeners.delete(listener);

    // If no more listeners, stop the timer
    if (listeners.size === 0) {
      stopTimer();
    }
  };
}

/**
 * Get current time snapshot
 * @returns {number} Current timestamp in milliseconds
 */
function getSnapshot() {
  return currentNow;
}

/**
 * Get server-side snapshot for SSR safety
 * @returns {number} Current timestamp in milliseconds
 */
function getServerSnapshot() {
  return Date.now();
}

/**
 * Add cadence hint for timer frequency
 * @param {string} id - Unique identifier for the hint
 * @param {number} ms - Cadence in milliseconds
 */
function addCadenceHint(id, ms) {
  cadenceHints.set(id, ms);
  recalculateInterval();
}

/**
 * Remove cadence hint
 * @param {string} id - Unique identifier for the hint
 */
function removeCadenceHint(id) {
  cadenceHints.delete(id);
  recalculateInterval();
}

/**
 * Recalculate the active interval based on current hints and visibility state
 */
function recalculateInterval() {
  const minCadence = Math.min(...cadenceHints.values(), 1000);
  const newIntervalMs = isBackground ? Math.max(minCadence, 60000) : minCadence;

  if (newIntervalMs !== activeIntervalMs) {
    activeIntervalMs = newIntervalMs;

    // Restart timer if we have listeners
    if (listeners.size > 0) {
      stopTimer();
      startTimer();
    }
  }
}

/**
 * Start the timer interval
 */
function startTimer() {
  if (timerId !== null) return;

  timerId = setInterval(() => {
    currentNow = Math.floor(performance.now() + offset);

    // Notify all listeners
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("Error in time store listener:", error);
      }
    });
  }, activeIntervalMs);
}

/**
 * Stop the timer interval
 */
function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

/**
 * Handle visibility change events
 */
function handleVisibilityChange() {
  const wasBackground = isBackground;
  isBackground = document.visibilityState === "hidden";

  if (wasBackground !== isBackground) {
    recalculateInterval();
  }
}

// Set up visibility change listener
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

export {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  addCadenceHint,
  removeCadenceHint,
};
