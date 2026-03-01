import { describe, it, expect } from "vitest";
import { validateWithSchema } from "../src/api/validators/json.js";
import { researchJsonSchema } from "../demo/pipeline-config/content-generation/tasks/research.js";
import { readFileSync, existsSync } from "node:fs";

describe("Research Schema Validation", () => {
  const validMinimalObject = {
    researchSummary: "Brief overview of research findings",
    keyFindings: [
      {
        area: "Market analysis",
        findings: "Detailed findings about the market",
      },
    ],
    additionalInsights: "Additional insights",
    criticalPerspectives: "Critical analysis and concerns",
    researchCompleteness: "Assessment of research completeness",
  };

  it("validates a minimal correct research object", () => {
    const result = validateWithSchema(researchJsonSchema, validMinimalObject);
    expect(result.valid).toBe(true);
  });

  it("rejects missing required 'criticalPerspectives'", () => {
    const invalidObject = { ...validMinimalObject };
    delete invalidObject.criticalPerspectives;

    const result = validateWithSchema(researchJsonSchema, invalidObject);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "required",
          instancePath: "",
          params: { missingProperty: "criticalPerspectives" },
        }),
      ])
    );
  });

  it("rejects when keyFindings items are malformed (missing area or findings)", () => {
    const invalidObject = {
      ...validMinimalObject,
      keyFindings: [
        {
          findings: "Missing area field",
        },
      ],
    };

    const result = validateWithSchema(researchJsonSchema, invalidObject);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "required",
          instancePath: "/keyFindings/0",
          params: { missingProperty: "area" },
        }),
      ])
    );
  });

  it("accepts sample refined output if artifact exists", () => {
    const artifactPath =
      "./demo/pipeline-data/current/6QCCa6Zd8qlo/files/artifacts/research-output-2.json";

    if (!existsSync(artifactPath)) {
      // Skip test if artifact doesn't exist
      return;
    }

    const artifactContent = readFileSync(artifactPath, "utf8");
    const result = validateWithSchema(researchJsonSchema, artifactContent);
    expect(result.valid).toBe(true);
  });
});
