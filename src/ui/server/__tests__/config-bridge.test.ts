import { describe, expect, it } from "vitest";

import {
  Constants,
  createErrorResponse,
  getStatusPriority,
  validateJobId,
  validateTaskState,
} from "../config-bridge";

describe("config-bridge", () => {
  it("validates job ids", () => {
    expect(validateJobId("abc-123_XYZ")).toBe(true);
    expect(validateJobId("../etc")).toBe(false);
    expect(validateJobId("")).toBe(false);
    expect(validateJobId("a b")).toBe(false);
  });

  it("validates task states", () => {
    for (const state of Constants.TASK_STATES) {
      expect(validateTaskState(state)).toBe(true);
    }
    expect(validateTaskState("invalid")).toBe(false);
  });

  it("returns status priorities", () => {
    expect(getStatusPriority("running")).toBe(4);
    expect(getStatusPriority("error")).toBe(3);
    expect(getStatusPriority("pending")).toBe(2);
    expect(getStatusPriority("complete")).toBe(1);
    expect(getStatusPriority("unknown")).toBe(0);
  });

  it("creates structured error responses", () => {
    expect(createErrorResponse("NOT_FOUND", "missing")).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "missing",
    });
  });
});
