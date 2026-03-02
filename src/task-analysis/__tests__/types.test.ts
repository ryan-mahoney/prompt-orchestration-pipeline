import { describe, it, expect } from "vitest";
import type {
  SourceLocation,
  Stage,
  ArtifactRead,
  ArtifactWrite,
  UnresolvedRead,
  UnresolvedWrite,
  ModelCall,
  ArtifactData,
  TaskAnalysis,
  PersistedTaskAnalysis,
  DeducedSchema,
  ArtifactResolution,
  ArtifactDescriptor,
  UnresolvedArtifactDescriptor,
} from "../types.js";

describe("task-analysis types", () => {
  it("SourceLocation accepts line and column", () => {
    const loc: SourceLocation = { line: 1, column: 5 };
    expect(loc.line).toBe(1);
    expect(loc.column).toBe(5);
  });

  it("Stage accepts name, order, and isAsync", () => {
    const stage: Stage = { name: "ingestion", order: 10, isAsync: true };
    expect(stage.name).toBe("ingestion");
    expect(stage.isAsync).toBe(true);
  });

  it("ArtifactRead accepts fileName, stage, and required", () => {
    const read: ArtifactRead = { fileName: "data.json", stage: "parse", required: true };
    expect(read.fileName).toBe("data.json");
    expect(read.required).toBe(true);
  });

  it("ArtifactWrite accepts fileName and stage", () => {
    const write: ArtifactWrite = { fileName: "output.json", stage: "refine" };
    expect(write.fileName).toBe("output.json");
    expect(write.stage).toBe("refine");
  });

  it("UnresolvedRead accepts all fields including location", () => {
    const loc: SourceLocation = { line: 3, column: 2 };
    const unresolved: UnresolvedRead = {
      expression: "dynamicName",
      codeContext: "io.readArtifact(dynamicName)",
      stage: "parse",
      required: false,
      location: loc,
    };
    expect(unresolved.expression).toBe("dynamicName");
    expect(unresolved.required).toBe(false);
    expect(unresolved.location.line).toBe(3);
  });

  it("UnresolvedWrite accepts all fields including location", () => {
    const loc: SourceLocation = { line: 7, column: 0 };
    const unresolved: UnresolvedWrite = {
      expression: "outputVar",
      codeContext: "io.writeArtifact(outputVar)",
      stage: "write",
      location: loc,
    };
    expect(unresolved.stage).toBe("write");
    expect(unresolved.location.column).toBe(0);
  });

  it("ModelCall accepts provider, method, and stage", () => {
    const call: ModelCall = { provider: "deepseek", method: "chat", stage: "analyze" };
    expect(call.provider).toBe("deepseek");
    expect(call.method).toBe("chat");
  });

  it("ArtifactData requires all four arrays", () => {
    const data: ArtifactData = {
      reads: [],
      writes: [],
      unresolvedReads: [],
      unresolvedWrites: [],
    };
    expect(Array.isArray(data.reads)).toBe(true);
    expect(Array.isArray(data.writes)).toBe(true);
    expect(Array.isArray(data.unresolvedReads)).toBe(true);
    expect(Array.isArray(data.unresolvedWrites)).toBe(true);
  });

  it("TaskAnalysis accepts taskFilePath as null", () => {
    const analysis: TaskAnalysis = {
      taskFilePath: null,
      stages: [],
      artifacts: { reads: [], writes: [], unresolvedReads: [], unresolvedWrites: [] },
      models: [],
    };
    expect(analysis.taskFilePath).toBeNull();
  });

  it("TaskAnalysis accepts taskFilePath as a string", () => {
    const analysis: TaskAnalysis = {
      taskFilePath: "/path/to/task.js",
      stages: [],
      artifacts: { reads: [], writes: [], unresolvedReads: [], unresolvedWrites: [] },
      models: [],
    };
    expect(analysis.taskFilePath).toBe("/path/to/task.js");
  });

  it("PersistedTaskAnalysis extends TaskAnalysis with analyzedAt", () => {
    const persisted: PersistedTaskAnalysis = {
      taskFilePath: "/task.js",
      stages: [],
      artifacts: { reads: [], writes: [], unresolvedReads: [], unresolvedWrites: [] },
      models: [],
      analyzedAt: "2026-03-02T00:00:00.000Z",
    };
    expect(persisted.analyzedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(persisted.taskFilePath).toBe("/task.js");
  });

  it("DeducedSchema accepts schema, example, and reasoning", () => {
    const deduced: DeducedSchema = {
      schema: { type: "object", properties: {} },
      example: { name: "test" },
      reasoning: "Inferred from usage",
    };
    expect(deduced.reasoning).toBe("Inferred from usage");
    expect(deduced.example).toEqual({ name: "test" });
  });

  it("ArtifactResolution accepts resolvedFileName as null", () => {
    const resolution: ArtifactResolution = {
      resolvedFileName: null,
      confidence: 0,
      reasoning: "Could not resolve",
    };
    expect(resolution.resolvedFileName).toBeNull();
    expect(resolution.confidence).toBe(0);
  });

  it("ArtifactResolution accepts resolvedFileName as a string", () => {
    const resolution: ArtifactResolution = {
      resolvedFileName: "data.json",
      confidence: 0.9,
      reasoning: "High confidence match",
    };
    expect(resolution.resolvedFileName).toBe("data.json");
  });

  it("ArtifactDescriptor accepts fileName and stage", () => {
    const descriptor: ArtifactDescriptor = { fileName: "report.json", stage: "generate" };
    expect(descriptor.fileName).toBe("report.json");
    expect(descriptor.stage).toBe("generate");
  });

  it("UnresolvedArtifactDescriptor accepts expression, codeContext, and stage", () => {
    const descriptor: UnresolvedArtifactDescriptor = {
      expression: "fileName",
      codeContext: "io.readArtifact(fileName)",
      stage: "process",
    };
    expect(descriptor.expression).toBe("fileName");
    expect(descriptor.codeContext).toBe("io.readArtifact(fileName)");
  });
});
