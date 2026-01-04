import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveArtifactReference } from "../../src/task-analysis/enrichers/artifact-resolver.js";
import * as llm from "../../src/llm/index.js";

describe("resolveArtifactReference", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleTaskCode = `
    export function stageOne({ io }) {
      const inputFile = getInputPath();
      const data = io.readArtifact(inputFile);
      return data;
    }
  `;

  const sampleUnresolved = {
    expression: "inputFile",
    codeContext:
      "const inputFile = getInputPath();\nconst data = io.readArtifact(inputFile);",
    stage: "stageOne",
  };

  const availableArtifacts = [
    "stage-0-output.json",
    "config.json",
    "results.json",
  ];

  it("returns resolved filename when LLM returns high confidence match", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue({
      content: JSON.stringify({
        resolvedFileName: "stage-0-output.json",
        confidence: 0.9,
        reasoning: "Variable name suggests input from previous stage",
      }),
    });

    const result = await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(result).toEqual({
      resolvedFileName: "stage-0-output.json",
      confidence: 0.9,
      reasoning: "Variable name suggests input from previous stage",
    });
  });

  it("returns low confidence when LLM is uncertain", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue({
      content: JSON.stringify({
        resolvedFileName: "config.json",
        confidence: 0.4,
        reasoning: "Could be config but naming is ambiguous",
      }),
    });

    const result = await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(result.resolvedFileName).toBe("config.json");
    expect(result.confidence).toBe(0.4);
  });

  it("returns null with confidence 0 when LLM response is malformed JSON", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue({
      content: "not valid json",
    });

    const result = await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(result.resolvedFileName).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("Failed to analyze artifact reference");
  });

  it("returns null with confidence 0 when chat throws error", async () => {
    vi.spyOn(llm, "chat").mockRejectedValue(new Error("API error"));

    const result = await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(result.resolvedFileName).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("Failed to analyze artifact reference");
  });

  it("includes task code, expression, and available artifacts in prompt", async () => {
    const chatSpy = vi.spyOn(llm, "chat").mockResolvedValue({
      content: JSON.stringify({
        resolvedFileName: null,
        confidence: 0,
        reasoning: "No match found",
      }),
    });

    await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(chatSpy).toHaveBeenCalledTimes(1);
    const callArgs = chatSpy.mock.calls[0][0];

    // Verify messages structure
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe("system");
    expect(callArgs.messages[1].role).toBe("user");

    // Verify user prompt contains key information
    const userPrompt = callArgs.messages[1].content;
    expect(userPrompt).toContain(sampleTaskCode);
    expect(userPrompt).toContain("inputFile");
    expect(userPrompt).toContain("stageOne");
    expect(userPrompt).toContain("stage-0-output.json");
    expect(userPrompt).toContain("config.json");
    expect(userPrompt).toContain("results.json");
  });

  it("calls chat with deepseek provider, temperature 0, and json_object format", async () => {
    const chatSpy = vi.spyOn(llm, "chat").mockResolvedValue({
      content: JSON.stringify({
        resolvedFileName: null,
        confidence: 0,
        reasoning: "No match",
      }),
    });

    await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        temperature: 0,
        responseFormat: "json_object",
      })
    );
  });

  it("handles missing fields in LLM response gracefully", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue({
      content: JSON.stringify({
        // Missing resolvedFileName, confidence, reasoning
      }),
    });

    const result = await resolveArtifactReference(
      sampleTaskCode,
      sampleUnresolved,
      availableArtifacts
    );

    expect(result.resolvedFileName).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("");
  });
});
