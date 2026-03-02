/**
 * Canonical log event constants and file extensions for the prompt orchestration pipeline.
 * This module serves as the single source of truth for all log-related naming conventions.
 */

// Log event types for different stages and events in the pipeline
export const LogEvent = Object.freeze({
  START: "start",
  COMPLETE: "complete",
  ERROR: "error",
  CONTEXT: "context",
  DEBUG: "debug",
  METRICS: "metrics",
  PIPELINE_START: "pipeline-start",
  PIPELINE_COMPLETE: "pipeline-complete",
  PIPELINE_ERROR: "pipeline-error",
  EXECUTION_LOGS: "execution-logs",
  FAILURE_DETAILS: "failure-details",
});

// File extensions for different log types
export const LogFileExtension = Object.freeze({
  TEXT: "log",
  JSON: "json",
});

// Validation sets for ensuring consistency
export const VALID_LOG_EVENTS = new Set(Object.values(LogEvent));
export const VALID_LOG_FILE_EXTENSIONS = new Set(
  Object.values(LogFileExtension)
);

/**
 * Validates a log event string.
 * @param {string} event - Log event to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidLogEvent(event) {
  return VALID_LOG_EVENTS.has(event);
}

/**
 * Validates a log file extension string.
 * @param {string} ext - File extension to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidLogFileExtension(ext) {
  return VALID_LOG_FILE_EXTENSIONS.has(ext);
}

/**
 * Normalizes a log event string to canonical form.
 * @param {string} event - Raw log event
 * @returns {string|null} Canonical log event or null if invalid
 */
export function normalizeLogEvent(event) {
  if (typeof event !== "string") {
    return null;
  }

  const normalized = event.toLowerCase().trim();
  return isValidLogEvent(normalized) ? normalized : null;
}

/**
 * Normalizes a log file extension string to canonical form.
 * @param {string} ext - Raw file extension
 * @returns {string|null} Canonical file extension or null if invalid
 */
export function normalizeLogFileExtension(ext) {
  if (typeof ext !== "string") {
    return null;
  }

  const normalized = ext.toLowerCase().trim().replace(/^\./, "");
  return isValidLogFileExtension(normalized) ? normalized : null;
}
