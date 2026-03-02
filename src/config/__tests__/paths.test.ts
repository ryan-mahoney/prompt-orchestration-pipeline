import { describe, it, expect } from "bun:test";
import {
  resolvePipelinePaths,
  getPendingSeedPath,
  getCurrentSeedPath,
  getCompleteSeedPath,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
} from "../paths";

describe("resolvePipelinePaths", () => {
  it("returns object with four path properties", () => {
    const paths = resolvePipelinePaths("/data");
    expect(paths.pending).toBe("/data/pipeline-data/pending");
    expect(paths.current).toBe("/data/pipeline-data/current");
    expect(paths.complete).toBe("/data/pipeline-data/complete");
    expect(paths.rejected).toBe("/data/pipeline-data/rejected");
  });

  it("returns a fresh object each call (not cached)", () => {
    const paths1 = resolvePipelinePaths("/data");
    const paths2 = resolvePipelinePaths("/data");
    expect(paths1).not.toBe(paths2);
  });

  it("works with nested base dirs", () => {
    const paths = resolvePipelinePaths("/home/user/project");
    expect(paths.pending).toBe("/home/user/project/pipeline-data/pending");
  });
});

describe("getPendingSeedPath", () => {
  it("returns flat seed file path in pending dir", () => {
    expect(getPendingSeedPath("/data", "job-1")).toBe(
      "/data/pipeline-data/pending/job-1-seed.json",
    );
  });

  it("uses flat naming (no subdirectory)", () => {
    const path = getPendingSeedPath("/base", "abc123");
    expect(path).toBe("/base/pipeline-data/pending/abc123-seed.json");
    expect(path).not.toContain("/abc123/");
  });
});

describe("getCurrentSeedPath", () => {
  it("returns nested seed file path in current dir", () => {
    expect(getCurrentSeedPath("/data", "job-1")).toBe(
      "/data/pipeline-data/current/job-1/seed.json",
    );
  });
});

describe("getCompleteSeedPath", () => {
  it("returns nested seed file path in complete dir", () => {
    expect(getCompleteSeedPath("/data", "job-1")).toBe(
      "/data/pipeline-data/complete/job-1/seed.json",
    );
  });
});

describe("getJobDirectoryPath", () => {
  it("returns job directory path for current", () => {
    expect(getJobDirectoryPath("/data", "job-1", "current")).toBe(
      "/data/pipeline-data/current/job-1",
    );
  });

  it("returns job directory path for rejected", () => {
    expect(getJobDirectoryPath("/data", "job-1", "rejected")).toBe(
      "/data/pipeline-data/rejected/job-1",
    );
  });

  it("returns job directory path for pending", () => {
    expect(getJobDirectoryPath("/data", "job-1", "pending")).toBe(
      "/data/pipeline-data/pending/job-1",
    );
  });

  it("returns job directory path for complete", () => {
    expect(getJobDirectoryPath("/data", "job-1", "complete")).toBe(
      "/data/pipeline-data/complete/job-1",
    );
  });
});

describe("getJobMetadataPath", () => {
  it("defaults location to current", () => {
    expect(getJobMetadataPath("/data", "job-1")).toBe(
      "/data/pipeline-data/current/job-1/job.json",
    );
  });

  it("uses specified location", () => {
    expect(getJobMetadataPath("/data", "job-1", "complete")).toBe(
      "/data/pipeline-data/complete/job-1/job.json",
    );
  });

  it("works for rejected location", () => {
    expect(getJobMetadataPath("/data", "job-1", "rejected")).toBe(
      "/data/pipeline-data/rejected/job-1/job.json",
    );
  });
});

describe("getJobPipelinePath", () => {
  it("defaults location to current", () => {
    expect(getJobPipelinePath("/data", "job-1")).toBe(
      "/data/pipeline-data/current/job-1/pipeline.json",
    );
  });

  it("uses specified location", () => {
    expect(getJobPipelinePath("/data", "job-1", "rejected")).toBe(
      "/data/pipeline-data/rejected/job-1/pipeline.json",
    );
  });
});
