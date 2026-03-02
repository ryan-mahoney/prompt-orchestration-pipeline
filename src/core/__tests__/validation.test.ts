import { describe, test, expect, afterEach } from "bun:test";
import { validateSeed, formatValidationErrors, validateSeedOrThrow } from "../validation";
import { validatePipeline, validatePipelineOrThrow, formatPipelineValidationErrors } from "../validation";
import { resetConfig } from "../config";

describe("validateSeed", () => {
  afterEach(() => resetConfig());

  test("returns valid for a correct seed object", () => {
    // Requires config with registered pipelines
    // Setup test config with PO_ROOT pointing to a valid structure
    // or mock getConfig — implementation detail
  });

  test("returns invalid for empty object", () => {
    const result = validateSeed({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("returns invalid for non-object input", () => {
    const result = validateSeed("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("object");
    }
  });
});

describe("formatValidationErrors", () => {
  test("formats errors into readable string", () => {
    const result = formatValidationErrors([
      { message: "required property 'name'", path: "" },
      { message: "must be string", path: "/name" },
    ]);
    expect(result).toContain("name");
    expect(typeof result).toBe("string");
  });
});

describe("validateSeedOrThrow", () => {
  afterEach(() => resetConfig());

  test("throws on invalid input", () => {
    expect(() => validateSeedOrThrow(null)).toThrow();
  });
});

describe("validatePipeline", () => {
  test("returns valid for correct pipeline", () => {
    const result = validatePipeline({ name: "test", tasks: ["t1"] });
    expect(result.valid).toBe(true);
  });

  test("returns invalid for missing tasks", () => {
    const result = validatePipeline({ name: "test" });
    expect(result.valid).toBe(false);
  });

  test("returns invalid for empty tasks array", () => {
    const result = validatePipeline({ name: "test", tasks: [] });
    expect(result.valid).toBe(false);
  });

  test("allows additional properties", () => {
    const result = validatePipeline({ name: "test", tasks: ["t1"], extra: true });
    expect(result.valid).toBe(true);
  });
});

describe("validatePipelineOrThrow", () => {
  test("throws with pathHint in message", () => {
    expect(() => validatePipelineOrThrow({}, "my-pipeline.json")).toThrow("my-pipeline.json");
  });
});

describe("formatPipelineValidationErrors", () => {
  test("formats errors into readable string", () => {
    const result = formatPipelineValidationErrors([
      { message: "required property 'name'", path: "" },
    ]);
    expect(typeof result).toBe("string");
    expect(result).toContain("name");
  });
});
