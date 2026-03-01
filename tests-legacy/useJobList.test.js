import { describe, it, expect } from "vitest";
import { useJobList } from "../src/ui/client/hooks/useJobList.js";

describe("useJobList", () => {
  it("should export a function", () => {
    expect(typeof useJobList).toBe("function");
  });

  it("should have the expected function name", () => {
    expect(useJobList.name).toBe("useJobList");
  });

  it("should be defined", () => {
    expect(useJobList).toBeDefined();
  });
});
