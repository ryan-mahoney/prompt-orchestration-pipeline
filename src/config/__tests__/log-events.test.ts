import { describe, it, expect } from "bun:test";
import {
  LogEvent,
  LogFileExtension,
  VALID_LOG_EVENTS,
  VALID_LOG_FILE_EXTENSIONS,
  isValidLogEvent,
  isValidLogFileExtension,
  normalizeLogEvent,
  normalizeLogFileExtension,
} from "../log-events";

describe("LogEvent", () => {
  it("has all 11 event type constants with correct values", () => {
    expect(LogEvent.START).toBe("start");
    expect(LogEvent.COMPLETE).toBe("complete");
    expect(LogEvent.ERROR).toBe("error");
    expect(LogEvent.CONTEXT).toBe("context");
    expect(LogEvent.DEBUG).toBe("debug");
    expect(LogEvent.METRICS).toBe("metrics");
    expect(LogEvent.PIPELINE_START).toBe("pipeline-start");
    expect(LogEvent.PIPELINE_COMPLETE).toBe("pipeline-complete");
    expect(LogEvent.PIPELINE_ERROR).toBe("pipeline-error");
    expect(LogEvent.EXECUTION_LOGS).toBe("execution-logs");
    expect(LogEvent.FAILURE_DETAILS).toBe("failure-details");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(LogEvent)).toBe(true);
  });
});

describe("LogFileExtension", () => {
  it("has TEXT and JSON constants", () => {
    expect(LogFileExtension.TEXT).toBe("log");
    expect(LogFileExtension.JSON).toBe("json");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(LogFileExtension)).toBe(true);
  });
});

describe("VALID_LOG_EVENTS", () => {
  it("has size 11 and contains all event values", () => {
    expect(VALID_LOG_EVENTS.size).toBe(11);
    expect(VALID_LOG_EVENTS.has("start")).toBe(true);
    expect(VALID_LOG_EVENTS.has("complete")).toBe(true);
    expect(VALID_LOG_EVENTS.has("error")).toBe(true);
    expect(VALID_LOG_EVENTS.has("context")).toBe(true);
    expect(VALID_LOG_EVENTS.has("debug")).toBe(true);
    expect(VALID_LOG_EVENTS.has("metrics")).toBe(true);
    expect(VALID_LOG_EVENTS.has("pipeline-start")).toBe(true);
    expect(VALID_LOG_EVENTS.has("pipeline-complete")).toBe(true);
    expect(VALID_LOG_EVENTS.has("pipeline-error")).toBe(true);
    expect(VALID_LOG_EVENTS.has("execution-logs")).toBe(true);
    expect(VALID_LOG_EVENTS.has("failure-details")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VALID_LOG_EVENTS.has("invalid")).toBe(false);
    expect(VALID_LOG_EVENTS.has("")).toBe(false);
  });
});

describe("VALID_LOG_FILE_EXTENSIONS", () => {
  it("contains log and json", () => {
    expect(VALID_LOG_FILE_EXTENSIONS.has("log")).toBe(true);
    expect(VALID_LOG_FILE_EXTENSIONS.has("json")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VALID_LOG_FILE_EXTENSIONS.has("txt")).toBe(false);
    expect(VALID_LOG_FILE_EXTENSIONS.has(".json")).toBe(false);
  });
});

describe("isValidLogEvent", () => {
  it("returns true for valid events", () => {
    expect(isValidLogEvent("start")).toBe(true);
    expect(isValidLogEvent("pipeline-complete")).toBe(true);
    expect(isValidLogEvent("failure-details")).toBe(true);
  });

  it("returns false for invalid strings", () => {
    expect(isValidLogEvent("invalid")).toBe(false);
    expect(isValidLogEvent("START")).toBe(false);
    expect(isValidLogEvent("")).toBe(false);
  });
});

describe("isValidLogFileExtension", () => {
  it("returns true for valid extensions", () => {
    expect(isValidLogFileExtension("log")).toBe(true);
    expect(isValidLogFileExtension("json")).toBe(true);
  });

  it("returns false for invalid extensions", () => {
    expect(isValidLogFileExtension("txt")).toBe(false);
    expect(isValidLogFileExtension(".json")).toBe(false);
    expect(isValidLogFileExtension("")).toBe(false);
  });
});

describe("normalizeLogEvent", () => {
  it("is case-insensitive", () => {
    expect(normalizeLogEvent("START")).toBe("start");
    expect(normalizeLogEvent("Error")).toBe("error");
    expect(normalizeLogEvent("PIPELINE-START")).toBe("pipeline-start");
  });

  it("trims whitespace", () => {
    expect(normalizeLogEvent("  error  ")).toBe("error");
    expect(normalizeLogEvent("\tcomplete\n")).toBe("complete");
  });

  it("returns null for non-string input", () => {
    expect(normalizeLogEvent(42)).toBeNull();
    expect(normalizeLogEvent(null)).toBeNull();
    expect(normalizeLogEvent(undefined)).toBeNull();
    expect(normalizeLogEvent({})).toBeNull();
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeLogEvent("bogus")).toBeNull();
    expect(normalizeLogEvent("begin")).toBeNull();
  });

  it("passes through canonical values", () => {
    expect(normalizeLogEvent("start")).toBe("start");
    expect(normalizeLogEvent("failure-details")).toBe("failure-details");
  });
});

describe("normalizeLogFileExtension", () => {
  it("strips leading dot", () => {
    expect(normalizeLogFileExtension(".json")).toBe("json");
    expect(normalizeLogFileExtension(".log")).toBe("log");
    expect(normalizeLogFileExtension(".LOG")).toBe("log");
  });

  it("is case-insensitive", () => {
    expect(normalizeLogFileExtension("JSON")).toBe("json");
    expect(normalizeLogFileExtension("LOG")).toBe("log");
  });

  it("returns null for non-string input", () => {
    expect(normalizeLogFileExtension(undefined)).toBeNull();
    expect(normalizeLogFileExtension(null)).toBeNull();
    expect(normalizeLogFileExtension(42)).toBeNull();
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeLogFileExtension("txt")).toBeNull();
    expect(normalizeLogFileExtension(".csv")).toBeNull();
  });

  it("passes through canonical values", () => {
    expect(normalizeLogFileExtension("json")).toBe("json");
    expect(normalizeLogFileExtension("log")).toBe("log");
  });
});
