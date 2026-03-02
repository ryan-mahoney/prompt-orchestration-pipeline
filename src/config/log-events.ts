export type LogEventValue =
  | "start"
  | "complete"
  | "error"
  | "context"
  | "debug"
  | "metrics"
  | "pipeline-start"
  | "pipeline-complete"
  | "pipeline-error"
  | "execution-logs"
  | "failure-details";

export type LogFileExtensionValue = "log" | "json";

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
} as const satisfies Record<string, LogEventValue>);

export const LogFileExtension = Object.freeze({
  TEXT: "log",
  JSON: "json",
} as const satisfies Record<string, LogFileExtensionValue>);

export const VALID_LOG_EVENTS: ReadonlySet<string> = new Set<LogEventValue>([
  LogEvent.START,
  LogEvent.COMPLETE,
  LogEvent.ERROR,
  LogEvent.CONTEXT,
  LogEvent.DEBUG,
  LogEvent.METRICS,
  LogEvent.PIPELINE_START,
  LogEvent.PIPELINE_COMPLETE,
  LogEvent.PIPELINE_ERROR,
  LogEvent.EXECUTION_LOGS,
  LogEvent.FAILURE_DETAILS,
]);

export const VALID_LOG_FILE_EXTENSIONS: ReadonlySet<string> = new Set<LogFileExtensionValue>([
  LogFileExtension.TEXT,
  LogFileExtension.JSON,
]);

export function isValidLogEvent(event: string): event is LogEventValue {
  return VALID_LOG_EVENTS.has(event);
}

export function isValidLogFileExtension(ext: string): ext is LogFileExtensionValue {
  return VALID_LOG_FILE_EXTENSIONS.has(ext);
}

export function normalizeLogEvent(event: unknown): LogEventValue | null {
  if (typeof event !== "string") return null;
  const normalized = event.toLowerCase().trim();
  if (VALID_LOG_EVENTS.has(normalized)) return normalized as LogEventValue;
  return null;
}

export function normalizeLogFileExtension(ext: unknown): LogFileExtensionValue | null {
  if (typeof ext !== "string") return null;
  const normalized = ext.toLowerCase().trim().replace(/^\./, "");
  if (VALID_LOG_FILE_EXTENSIONS.has(normalized)) return normalized as LogFileExtensionValue;
  return null;
}
