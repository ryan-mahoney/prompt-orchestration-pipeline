import { describe, it, expect } from "vitest";
import {
  validateSeed,
  formatValidationErrors,
  validateSeedOrThrow,
} from "../src/core/validation.js";

describe("validateSeed", () => {
  it("should validate a correct seed", () => {
    const seed = {
      name: "test-job",
      data: { key: "value" },
      pipeline: "content",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should validate seed with metadata", () => {
    const seed = {
      name: "test-job",
      data: { key: "value" },
      pipeline: "content",
      metadata: { author: "test" },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });

  it("should reject seed without name", () => {
    const seed = {
      data: { key: "value" },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject seed without data", () => {
    const seed = {
      name: "test-job",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject seed with invalid name (too short)", () => {
    const seed = {
      name: "",
      data: { key: "value" },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });

  it("should reject seed with invalid name (too long)", () => {
    const seed = {
      name: "a".repeat(101),
      data: { key: "value" },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });

  it("should reject seed with invalid name (special characters)", () => {
    const seed = {
      name: "test@job!",
      data: { key: "value" },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });

  it("should accept seed with valid name characters", () => {
    const validNames = [
      "test-job",
      "test_job",
      "testJob123",
      "TEST-JOB-123",
      "job_123-test",
    ];

    for (const name of validNames) {
      const seed = { name, data: {}, pipeline: "content" };
      const result = validateSeed(seed);
      expect(result.valid).toBe(true);
    }
  });

  it("should reject seed with additional properties", () => {
    const seed = {
      name: "test-job",
      data: { key: "value" },
      extraField: "not allowed",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });

  it("should reject non-object seed", () => {
    const result = validateSeed("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("valid JSON object");
  });

  it("should reject null seed", () => {
    const result = validateSeed(null);
    expect(result.valid).toBe(false);
  });

  it("should reject undefined seed", () => {
    const result = validateSeed(undefined);
    expect(result.valid).toBe(false);
  });

  it("should reject seed with non-object data", () => {
    const seed = {
      name: "test-job",
      data: "not an object",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });

  it("should reject seed with non-object metadata", () => {
    const seed = {
      name: "test-job",
      data: {},
      metadata: "not an object",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(false);
  });
});

describe("formatValidationErrors", () => {
  it("should format single error", () => {
    const errors = [
      {
        message: "must have required property 'name'",
        path: "",
      },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain("Seed validation failed");
    expect(formatted).toContain("must have required property 'name'");
  });

  it("should format multiple errors", () => {
    const errors = [
      {
        message: "must have required property 'name'",
        path: "",
      },
      {
        message: "must have required property 'data'",
        path: "",
      },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain("must have required property 'name'");
    expect(formatted).toContain("must have required property 'data'");
  });

  it("should include path in error message", () => {
    const errors = [
      {
        message: "must be string",
        path: "/name",
      },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain("at '/name'");
  });

  it("should handle empty errors array", () => {
    const formatted = formatValidationErrors([]);
    expect(formatted).toContain("Unknown validation error");
  });

  it("should handle undefined errors", () => {
    const formatted = formatValidationErrors(undefined);
    expect(formatted).toContain("Unknown validation error");
  });
});

describe("validateSeedOrThrow", () => {
  it("should not throw for valid seed", () => {
    const seed = {
      name: "test-job",
      data: { key: "value" },
      pipeline: "content",
    };

    expect(() => validateSeedOrThrow(seed)).not.toThrow();
  });

  it("should throw for invalid seed", () => {
    const seed = {
      data: { key: "value" },
    };

    expect(() => validateSeedOrThrow(seed)).toThrow();
  });

  it("should throw with formatted error message", () => {
    const seed = {
      name: "test-job",
    };

    expect(() => validateSeedOrThrow(seed)).toThrow(/Seed validation failed/);
    expect(() => validateSeedOrThrow(seed)).toThrow(/data/);
  });

  it("should throw for seed with invalid name pattern", () => {
    const seed = {
      name: "test@job",
      data: {},
    };

    expect(() => validateSeedOrThrow(seed)).toThrow();
  });
});

describe("Edge Cases", () => {
  it("should handle empty data object", () => {
    const seed = {
      name: "test-job",
      data: {},
      pipeline: "content",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });

  it("should handle empty metadata object", () => {
    const seed = {
      name: "test-job",
      data: {},
      pipeline: "content",
      metadata: {},
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });

  it("should handle nested data structures", () => {
    const seed = {
      name: "test-job",
      data: {
        nested: {
          deep: {
            value: "test",
          },
        },
        array: [1, 2, 3],
      },
      pipeline: "content",
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });

  it("should handle complex metadata", () => {
    const seed = {
      name: "test-job",
      data: {},
      pipeline: "content",
      metadata: {
        author: "test",
        timestamp: new Date().toISOString(),
        tags: ["tag1", "tag2"],
      },
    };

    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });
});
