import { describe, it, expect } from "vitest";
import type {
  Registry,
  PipelineRegistryEntry,
  PipelineConfig,
  ReexecArgs,
  TaskIndex,
} from "../types.js";

describe("CLI types", () => {
  it("Registry with empty pipelines is valid", () => {
    const registry: Registry = { pipelines: {} };
    expect(registry.pipelines).toEqual({});
  });

  it("Registry with pipeline entries is valid", () => {
    const entry: PipelineRegistryEntry = {
      name: "my-pipeline",
      description: "A test pipeline",
      pipelinePath: "./pipeline-config/my-pipeline/pipeline.json",
      taskRegistryPath: "./pipeline-config/my-pipeline/tasks/index.ts",
    };
    const registry: Registry = { pipelines: { "my-pipeline": entry } };
    expect(registry.pipelines["my-pipeline"]).toBe(entry);
  });

  it("PipelineConfig with all required fields is valid", () => {
    const config: PipelineConfig = {
      name: "my-pipeline",
      version: "1.0.0",
      description: "A test pipeline",
      tasks: ["task-a", "task-b"],
    };
    expect(config.name).toBe("my-pipeline");
    expect(config.version).toBe("1.0.0");
    expect(config.tasks).toHaveLength(2);
  });

  it("ReexecArgs is valid with execPath and args array", () => {
    const reexecArgs: ReexecArgs = {
      execPath: "/usr/local/bin/bun",
      args: ["_start-ui"],
    };
    expect(reexecArgs.execPath).toBe("/usr/local/bin/bun");
    expect(reexecArgs.args).toContain("_start-ui");
  });

  it("TaskIndex maps string keys to string values", () => {
    const index: TaskIndex = {
      "task-a": "./task-a.ts",
      "task-b": "./task-b.ts",
    };
    expect(index["task-a"]).toBe("./task-a.ts");
    expect(Object.keys(index)).toHaveLength(2);
  });
});
