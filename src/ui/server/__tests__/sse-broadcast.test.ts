import { describe, expect, it, vi } from "vitest";

import { broadcastStateUpdate } from "../sse-broadcast";
import { sseRegistry } from "../sse-registry";

describe("sse-broadcast", () => {
  it("broadcasts prioritized state changes with job context", () => {
    const spy = vi.spyOn(sseRegistry, "broadcast").mockImplementation(() => undefined);
    broadcastStateUpdate({
      recentChanges: [
        {
          path: "pipeline-data/current/job-1/tasks-status.json",
          type: "modified",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ],
      changeCount: 1,
    });
    expect(spy).toHaveBeenCalledWith(
      "state:change",
      expect.objectContaining({ jobId: "job-1", lifecycle: "current" }),
    );
  });

  it("falls back to summary and never throws", () => {
    const spy = vi.spyOn(sseRegistry, "broadcast").mockImplementation(() => {
      throw new Error("x");
    });
    expect(() => broadcastStateUpdate({ recentChanges: [], changeCount: 2 })).not.toThrow();
    spy.mockRestore();
  });
});
