import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as researchModule from "../../demo/pipeline-config/content-generation/tasks/research.js";
import { vi } from "vitest";

describe("research validateStructure integration", () => {
  let mockIo;
  let mockData;
  let mockMeta;
  let mockFlags;

  beforeEach(() => {
    mockIo = {
      readArtifact: vi.fn(),
    };
    mockData = {};
    mockMeta = {};
    mockFlags = { someFlag: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should set validationFailed to false for valid data", async () => {
    const validData = {
      researchSummary: "Valid research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Detailed findings about technology.",
          sources: ["source1"],
        },
      ],
      additionalInsights: "Additional insights.",
      researchCompleteness: "Complete research.",
    };

    mockIo.readArtifact.mockResolvedValue(JSON.stringify(validData));

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(false);
    expect(mockIo.readArtifact).toHaveBeenCalledWith("research-output.json");
  });

  it("should set validationFailed to true for invalid data and log warnings", async () => {
    const invalidData = {
      // Missing required fields
      researchSummary: "Summary only",
      // keyFindings missing
      additionalInsights: "Insights",
      // researchCompleteness missing
    };

    mockIo.readArtifact.mockResolvedValue(JSON.stringify(invalidData));

    const consoleSpy = vi.spyOn(console, "warn");

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Research:validateStructure] Validation failed",
      expect.any(Array)
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Research:validateStructure] Validation failed"),
      expect.any(Array)
    );
  });

  it("should set validationFailed to true for malformed JSON and log warning", async () => {
    const malformedJson = '{"researchSummary": "summary", "invalid": json}';

    mockIo.readArtifact.mockResolvedValue(malformedJson);

    const consoleSpy = vi.spyOn(console, "warn");

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[Research:validateStructure] ⚠ JSON parsing failed:"
      )
    );
  });

  it("should handle extra properties in root object", async () => {
    const dataWithExtraProps = {
      researchSummary: "Summary",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings",
        },
      ],
      additionalInsights: "Insights",
      researchCompleteness: "Complete",
      extraProperty: "This should not be allowed",
    };

    mockIo.readArtifact.mockResolvedValue(JSON.stringify(dataWithExtraProps));

    const consoleSpy = vi.spyOn(console, "warn");

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Research:validateStructure] Validation failed",
      expect.any(Array)
    );
  });

  it("should handle extra properties in keyFindings items", async () => {
    const dataWithExtraPropsInItems = {
      researchSummary: "Summary",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings",
          extraProperty: "This should not be allowed",
        },
      ],
      additionalInsights: "Insights",
      researchCompleteness: "Complete",
    };

    mockIo.readArtifact.mockResolvedValue(
      JSON.stringify(dataWithExtraPropsInItems)
    );

    const consoleSpy = vi.spyOn(console, "warn");

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Research:validateStructure] Validation failed",
      expect.any(Array)
    );
  });

  it("should preserve existing flags and only modify validationFailed", async () => {
    const validData = {
      researchSummary: "Valid summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings",
        },
      ],
      additionalInsights: "Insights",
      researchCompleteness: "Complete",
    };

    mockIo.readArtifact.mockResolvedValue(JSON.stringify(validData));

    const originalFlags = {
      existingFlag: "preserved",
      anotherFlag: 42,
      validationFailed: true, // This should be overwritten
    };

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: originalFlags,
    });

    expect(result.flags).toEqual({
      existingFlag: "preserved",
      anotherFlag: 42,
      validationFailed: false, // Overwritten to false for valid data
    });
  });

  it("should handle empty keyFindings array", async () => {
    const dataWithEmptyArray = {
      researchSummary: "Summary",
      keyFindings: [], // Should fail minItems: 1
      additionalInsights: "Insights",
      researchCompleteness: "Complete",
    };

    mockIo.readArtifact.mockResolvedValue(JSON.stringify(dataWithEmptyArray));

    const consoleSpy = vi.spyOn(console, "warn");

    const result = await researchModule.validateStructure({
      io: mockIo,
      llm: {},
      data: mockData,
      meta: mockMeta,
      flags: mockFlags,
    });

    expect(result.flags.validationFailed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[Research:validateStructure] Validation failed",
      expect.any(Array)
    );
  });
});
