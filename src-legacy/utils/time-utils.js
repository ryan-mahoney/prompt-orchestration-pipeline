/**
 * Time utilities for handling timestamp conversions
 */

/**
 * Converts a timestamp string or number to milliseconds since epoch
 * @param {string|number|null|undefined} timestamp - ISO string, milliseconds, or null/undefined
 * @returns {number|null} Milliseconds since epoch, or null if input is invalid
 */
export function toMilliseconds(timestamp) {
  if (timestamp === null || timestamp === undefined) {
    return null;
  }

  // If it's already a number, return as-is
  if (typeof timestamp === "number") {
    return isNaN(timestamp) ? null : timestamp;
  }

  // If it's a string, try to parse it as an ISO date
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return isNaN(parsed) ? null : parsed;
  }

  // Invalid type
  return null;
}

/**
 * Safely converts startedAt/endedAt timestamps for TimerText components
 * @param {Object} task - Task object with startedAt and/or endedAt
 * @returns {Object} Object with startMs and endMs as numbers or null
 */
export function taskToTimerProps(task) {
  return {
    startMs: toMilliseconds(task?.startedAt),
    endMs: toMilliseconds(task?.endedAt),
  };
}
