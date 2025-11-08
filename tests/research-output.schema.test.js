import { describe, it, expect } from "vitest";
import { validateWithSchema } from "../src/api/validators/json.js";
import path from "node:path";

describe("research-output.schema", () => {
  const schemaPath = path.join(
    process.cwd(),
    "demo/pipeline-config/content-generation/schemas/research-output.schema.json"
  );

  it("should validate a valid research output object", async () => {
    const validData = {
      researchSummary: "This is a comprehensive research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Detailed findings about technology trends.",
          sources: ["source1", "source2"],
        },
        {
          area: "Market",
          findings: "Market analysis and trends.",
        },
      ],
      additionalInsights: "Additional insights and observations.",
      researchCompleteness:
        "The research covers all major aspects comprehensively.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: validData,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should reject missing researchSummary", async () => {
    const invalidData = {
      keyFindings: [
        {
          area: "Technology",
          findings: "Detailed findings about technology trends.",
        },
      ],
      additionalInsights: "Additional insights.",
      researchCompleteness: "Complete research.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "" &&
          error.params.missingProperty === "researchSummary"
      )
    ).toBe(true);
  });

  it("should reject keyFindings as object instead of array", async () => {
    const invalidData = {
      researchSummary: "Research summary.",
      keyFindings: {}, // Should be array
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "/keyFindings" &&
          error.message?.includes("must be array")
      )
    ).toBe(true);
  });

  it("should reject extra root properties", async () => {
    const invalidData = {
      researchSummary: "Research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings.",
        },
      ],
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
      extraProperty: "This should not be allowed.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "" && error.keyword === "additionalProperties"
      )
    ).toBe(true);
  });

  it("should reject extra properties in keyFindings items", async () => {
    const invalidData = {
      researchSummary: "Research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings.",
          extraProperty: "This should not be allowed.",
        },
      ],
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "/keyFindings/0" &&
          error.keyword === "additionalProperties"
      )
    ).toBe(true);
  });

  it("should reject empty strings for required fields", async () => {
    const invalidData = {
      researchSummary: "", // Empty string should fail minLength: 1
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings.",
        },
      ],
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "/researchSummary" &&
          error.keyword === "minLength"
      )
    ).toBe(true);
  });

  it("should reject empty keyFindings array", async () => {
    const invalidData = {
      researchSummary: "Research summary.",
      keyFindings: [], // Should have minItems: 1
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: invalidData,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(
      result.errors.some(
        (error) =>
          error.instancePath === "/keyFindings" && error.keyword === "minItems"
      )
    ).toBe(true);
  });

  it("should accept valid data without optional sources", async () => {
    const validData = {
      researchSummary: "Research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings.",
          // sources is optional
        },
      ],
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: validData,
    });

    expect(result.valid).toBe(true);
  });

  it("should accept empty sources array", async () => {
    const validData = {
      researchSummary: "Research summary.",
      keyFindings: [
        {
          area: "Technology",
          findings: "Findings.",
          sources: [], // Empty array is allowed for sources
        },
      ],
      additionalInsights: "Insights.",
      researchCompleteness: "Complete.",
    };

    const result = await validateWithSchema({
      schemaPath,
      data: validData,
    });

    expect(result.valid).toBe(true);
  });
});
