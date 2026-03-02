import { describe, expect, it } from "vitest";

import {
  createInitialAnalysisState,
  reduceAnalysisEvent,
} from "../hooks/useAnalysisProgress";

describe("useAnalysisProgress helpers", () => {
  it("starts from the idle state", () => {
    expect(createInitialAnalysisState()).toMatchObject({
      status: "idle",
      completedTasks: 0,
    });
  });

  it("transitions to running on started", () => {
    const next = reduceAnalysisEvent(createInitialAnalysisState(), "started", { totalTasks: 3 });
    expect(next.status).toBe("running");
    expect(next.totalTasks).toBe(3);
  });

  it("increments task progress", () => {
    const next = reduceAnalysisEvent(createInitialAnalysisState(), "task:complete", {});
    expect(next.completedTasks).toBe(1);
  });

  it("marks completion", () => {
    const next = reduceAnalysisEvent(createInitialAnalysisState(), "complete", {});
    expect(next.status).toBe("complete");
  });

  it("captures errors", () => {
    const next = reduceAnalysisEvent(createInitialAnalysisState(), "error", { message: "boom" });
    expect(next).toMatchObject({ status: "error", error: "boom" });
  });
});
