import { describe, it, expect } from "bun:test";
import { isCompiledBinary, buildReexecArgs } from "../self-reexec.ts";

describe("isCompiledBinary", () => {
  it("returns false when running from source", () => {
    expect(isCompiledBinary()).toBe(false);
  });
});

describe("buildReexecArgs", () => {
  it("returns execPath equal to process.execPath", () => {
    const result = buildReexecArgs(["_start-ui"]);
    expect(result.execPath).toBe(process.execPath);
  });

  it("includes the command in args for buildReexecArgs(['_start-ui'])", () => {
    const result = buildReexecArgs(["_start-ui"]);
    expect(result.args).toContain("_start-ui");
  });

  it("includes all args for buildReexecArgs(['_run-job', 'abc-123'])", () => {
    const result = buildReexecArgs(["_run-job", "abc-123"]);
    expect(result.args).toContain("_run-job");
    expect(result.args).toContain("abc-123");
  });
});
