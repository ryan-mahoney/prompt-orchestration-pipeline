import { beforeEach, describe, expect, it } from "vitest";

import { acquireLock, getLockStatus, releaseLock } from "../analysis-lock";

describe("analysis-lock", () => {
  beforeEach(() => {
    if (getLockStatus()) {
      releaseLock(getLockStatus()!.pipelineSlug);
    }
  });

  it("acquires and reports the active lock", () => {
    expect(acquireLock("pipeline-a")).toEqual({ acquired: true });
    expect(getLockStatus()?.pipelineSlug).toBe("pipeline-a");
  });

  it("rejects a second holder while locked", () => {
    acquireLock("pipeline-a");
    expect(acquireLock("pipeline-b")).toEqual({
      acquired: false,
      heldBy: "pipeline-a",
    });
  });

  it("releases only for the active holder", () => {
    acquireLock("pipeline-a");
    expect(() => releaseLock("pipeline-b")).toThrow(/held by "pipeline-a"/);
    releaseLock("pipeline-a");
    expect(getLockStatus()).toBeNull();
  });

  it("throws on invalid release and invalid acquire input", () => {
    expect(() => releaseLock("pipeline-a")).toThrow(/no lock is held/);
    expect(() => acquireLock("")).toThrow(/non-empty pipeline slug/);
  });
});
