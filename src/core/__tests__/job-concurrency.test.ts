import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { getConcurrencyRuntimePaths } from "../job-concurrency";

describe("getConcurrencyRuntimePaths", () => {
  test("resolves runtime paths under <dataDir>/runtime", () => {
    const dataDir = "/tmp/pipeline-data";
    const paths = getConcurrencyRuntimePaths(dataDir);
    expect(paths.runtimeDir).toBe(join(dataDir, "runtime"));
    expect(paths.lockDir).toBe(join(dataDir, "runtime", "lock"));
    expect(paths.runningJobsDir).toBe(join(dataDir, "runtime", "running-jobs"));
  });

  test("works with relative dataDir", () => {
    const paths = getConcurrencyRuntimePaths("data");
    expect(paths.runtimeDir).toBe(join("data", "runtime"));
    expect(paths.lockDir).toBe(join("data", "runtime", "lock"));
    expect(paths.runningJobsDir).toBe(join("data", "runtime", "running-jobs"));
  });
});
