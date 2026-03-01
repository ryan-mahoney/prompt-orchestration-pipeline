import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as llm from "../../src/llm/index.js";

// Must mock before importing the module under test
vi.mock("../../src/llm/index.js", () => ({
  chat: vi.fn(),
}));

describe("deduceArtifactSchema", () => {
  let deduceArtifactSchema;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Dynamic import to get fresh module with mocked dependencies
    const module = await import(
      "../../src/task-analysis/enrichers/schema-deducer.js"
    );
    deduceArtifactSchema = module.deduceArtifactSchema;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns schema, example, and reasoning from LLM response", async () => {
    const mockResponse = {
      content: {
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        example: { name: "test" },
        reasoning: "Found writeArtifact call",
      },
    };

    vi.mocked(llm.chat).mockResolvedValue(mockResponse);

    const result = await deduceArtifactSchema(
      'io.writeArtifact("out.json", data)',
      { fileName: "out.json", stage: "inference" }
    );

    expect(result.schema).toHaveProperty("$schema");
    expect(result.example).toEqual({ name: "test" });
    expect(result.reasoning).toBe("Found writeArtifact call");
  });

  it("throws when example does not validate against schema", async () => {
    const mockResponse = {
      content: {
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        example: { wrongKey: 123 }, // Missing required 'name'
        reasoning: "test",
      },
    };

    vi.mocked(llm.chat).mockResolvedValue(mockResponse);

    await expect(
      deduceArtifactSchema("code", { fileName: "out.json", stage: "test" })
    ).rejects.toThrow("does not validate against schema");
  });

  it("uses temperature=0 for deterministic output", async () => {
    const mockResponse = {
      content: {
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {},
          required: [],
        },
        example: {},
        reasoning: "test",
      },
    };

    vi.mocked(llm.chat).mockResolvedValue(mockResponse);

    await deduceArtifactSchema("code", { fileName: "out.json", stage: "test" });

    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        responseFormat: { type: "json_object" },
      })
    );
  });
});
