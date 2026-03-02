import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ChatResponse } from "../../providers/types.ts";

mock.module("../../llm/index.ts", () => ({
  chat: mock(),
}));

import { chat } from "../../llm/index.ts";
import { resolveArtifactReference } from "../enrichers/artifact-resolver.ts";

const mockedChat = chat as ReturnType<typeof mock>;

const TASK_CODE = `
export async function transform({ io }) {
  const input = await io.readArtifact(getInputFile());
  await io.writeArtifact("output.json", input);
}
`.trim();

const UNRESOLVED = {
  expression: "getInputFile()",
  codeContext: "io.readArtifact(getInputFile())",
  stage: "transform",
};

const AVAILABLE = ["data.json", "config.json", "output.json"];

function makeResponse(content: Record<string, unknown>): Promise<ChatResponse> {
  return Promise.resolve({
    content,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  });
}

beforeEach(() => {
  mockedChat.mockClear();
});

describe("resolveArtifactReference", () => {
  it("returns result as-is when resolvedFileName is in availableArtifacts", async () => {
    mockedChat.mockReturnValue(
      makeResponse({ resolvedFileName: "data.json", confidence: 0.9, reasoning: "Matches input pattern" }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result.resolvedFileName).toBe("data.json");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe("Matches input pattern");
  });

  it("returns null resolvedFileName and 0 confidence when filename not in availableArtifacts", async () => {
    mockedChat.mockReturnValue(
      makeResponse({ resolvedFileName: "hallucinated.json", confidence: 0.8, reasoning: "Guessed" }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result.resolvedFileName).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("clamps confidence to 1 when value exceeds 1", async () => {
    mockedChat.mockReturnValue(
      makeResponse({ resolvedFileName: "data.json", confidence: 7, reasoning: "Very confident" }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result.resolvedFileName).toBe("data.json");
    expect(result.confidence).toBe(1);
  });

  it("forces confidence to 0 when value is NaN", async () => {
    mockedChat.mockReturnValue(
      makeResponse({ resolvedFileName: "data.json", confidence: NaN, reasoning: "Uncertain" }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result.resolvedFileName).toBe("data.json");
    expect(result.confidence).toBe(0);
  });

  it("clamps confidence to 0 when value is negative", async () => {
    mockedChat.mockReturnValue(
      makeResponse({ resolvedFileName: "data.json", confidence: -1, reasoning: "Negative" }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result.resolvedFileName).toBe("data.json");
    expect(result.confidence).toBe(0);
  });

  it("returns fallback when content is a raw string (non-object)", async () => {
    mockedChat.mockReturnValue(
      Promise.resolve({
        content: '{"resolvedFileName":"x.json"}' as unknown as Record<string, unknown>,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
    );

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result).toEqual({
      resolvedFileName: null,
      confidence: 0,
      reasoning: "Failed to analyze artifact reference",
    });
  });

  it("returns fallback when chat throws", async () => {
    mockedChat.mockRejectedValue(new Error("Network error"));

    const result = await resolveArtifactReference(TASK_CODE, UNRESOLVED, AVAILABLE);

    expect(result).toEqual({
      resolvedFileName: null,
      confidence: 0,
      reasoning: "Failed to analyze artifact reference",
    });
  });
});
