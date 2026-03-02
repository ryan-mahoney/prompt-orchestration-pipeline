import { describe, it, expect } from "vitest";
import { analyzeTask } from "../index.js";

const TASK_CODE = `
export async function ingestion({ io, llm }) {
  const data = await io.readArtifact("raw-data.json");
  await io.writeArtifact("ingested.json", data);
  await llm.openai.complete({ prompt: "summarize" });
}

export function parsing({ io }) {
  try {
    const extra = io.readArtifact("optional.json");
  } catch {}
  const result = io.readArtifact("ingested.json");
  io.writeArtifact("parsed.json", result);
}

export const transform = async ({ io, llm }) => {
  const input = await io.readArtifact("parsed.json");
  await llm.anthropic.chat({ prompt: "transform" });
  await io.writeArtifact("transformed.json", input);
};
`.trim();

describe("analyzeTask", () => {
  it("returns null taskFilePath when not provided", () => {
    const result = analyzeTask(TASK_CODE);
    expect(result.taskFilePath).toBeNull();
  });

  it("returns null taskFilePath when explicitly passed null", () => {
    const result = analyzeTask(TASK_CODE, null);
    expect(result.taskFilePath).toBeNull();
  });

  it("returns provided taskFilePath", () => {
    const result = analyzeTask(TASK_CODE, "/path/to/task.js");
    expect(result.taskFilePath).toBe("/path/to/task.js");
  });

  it("extracts all stages in order", () => {
    const result = analyzeTask(TASK_CODE);
    expect(result.stages).toHaveLength(3);

    const names = result.stages.map((s) => s.name);
    expect(names).toEqual(["ingestion", "parsing", "transform"]);

    expect(result.stages[0]?.isAsync).toBe(true);
    expect(result.stages[1]?.isAsync).toBe(false);
    expect(result.stages[2]?.isAsync).toBe(true);
  });

  it("extracts artifact reads", () => {
    const result = analyzeTask(TASK_CODE);
    const readNames = result.artifacts.reads.map((r) => r.fileName);
    expect(readNames).toContain("raw-data.json");
    expect(readNames).toContain("ingested.json");
    expect(readNames).toContain("parsed.json");
  });

  it("marks reads inside try blocks as not required", () => {
    const result = analyzeTask(TASK_CODE);
    const optional = result.artifacts.reads.find(
      (r) => r.fileName === "optional.json"
    );
    expect(optional).toBeDefined();
    expect(optional?.required).toBe(false);
  });

  it("marks reads outside try blocks as required", () => {
    const result = analyzeTask(TASK_CODE);
    const required = result.artifacts.reads.filter((r) => r.required);
    const names = required.map((r) => r.fileName);
    expect(names).toContain("raw-data.json");
    expect(names).toContain("ingested.json");
    expect(names).toContain("parsed.json");
  });

  it("extracts artifact writes", () => {
    const result = analyzeTask(TASK_CODE);
    const writeNames = result.artifacts.writes.map((w) => w.fileName);
    expect(writeNames).toContain("ingested.json");
    expect(writeNames).toContain("parsed.json");
    expect(writeNames).toContain("transformed.json");
  });

  it("assigns correct stage to reads and writes", () => {
    const result = analyzeTask(TASK_CODE);
    const rawRead = result.artifacts.reads.find(
      (r) => r.fileName === "raw-data.json"
    );
    expect(rawRead?.stage).toBe("ingestion");

    const transformedWrite = result.artifacts.writes.find(
      (w) => w.fileName === "transformed.json"
    );
    expect(transformedWrite?.stage).toBe("transform");
  });

  it("extracts LLM calls with provider and method", () => {
    const result = analyzeTask(TASK_CODE);
    expect(result.models).toHaveLength(2);

    const openaiCall = result.models.find((m) => m.provider === "openai");
    expect(openaiCall).toBeDefined();
    expect(openaiCall?.method).toBe("complete");
    expect(openaiCall?.stage).toBe("ingestion");

    const anthropicCall = result.models.find((m) => m.provider === "anthropic");
    expect(anthropicCall).toBeDefined();
    expect(anthropicCall?.method).toBe("chat");
    expect(anthropicCall?.stage).toBe("transform");
  });

  it("has no unresolved reads or writes for static filenames", () => {
    const result = analyzeTask(TASK_CODE);
    expect(result.artifacts.unresolvedReads).toHaveLength(0);
    expect(result.artifacts.unresolvedWrites).toHaveLength(0);
  });

  it("collects unresolved reads for dynamic filenames", () => {
    const code = `
export function stage({ io }) {
  const name = getFileName();
  io.readArtifact(name);
}
    `.trim();
    const result = analyzeTask(code);
    expect(result.artifacts.unresolvedReads).toHaveLength(1);
    expect(result.artifacts.unresolvedReads[0]?.stage).toBe("stage");
  });

  it("propagates parse errors", () => {
    expect(() => analyzeTask("export function {")).toThrow(Error);
    try {
      analyzeTask("export function {");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/line \d+, column \d+/);
    }
  });
});
