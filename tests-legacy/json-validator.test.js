import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateWithSchema } from "../src/api/validators/json.js";

describe("validateWithSchema", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic validation", () => {
    it("should validate valid data against schema", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const data = { name: "John", age: 30 };
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should reject invalid data", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const data = { age: 30 }; // missing required 'name'
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("required"),
          }),
        ])
      );
    });

    it("should parse string data to JSON object", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const data = '{"name": "John"}';
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    it("should return error for invalid JSON string", () => {
      const schema = {
        type: "object",
      };

      const data = '{"name": invalid}';
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        {
          instancePath: "",
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be a valid JSON object (string parsing failed)",
        },
      ]);
    });
  });

  describe("schema caching with $id", () => {
    it("should handle schema with $id on first validation", () => {
      const schema = {
        $id: "https://example.com/person.schema.json",
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      const data = { name: "John", age: 30 };
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    it("should not throw redeclaration error on repeated validation with same $id", () => {
      const schema = {
        $id: "https://example.com/user.schema.json",
        type: "object",
        properties: {
          username: { type: "string" },
          email: { type: "string", format: "email" },
        },
        required: ["username", "email"],
      };

      // First validation - compiles and caches schema
      const data1 = { username: "user1", email: "user1@example.com" };
      const result1 = validateWithSchema(schema, data1);
      expect(result1.valid).toBe(true);

      // Second validation - should use cached schema, not throw redeclaration error
      const data2 = { username: "user2", email: "user2@example.com" };
      const result2 = validateWithSchema(schema, data2);
      expect(result2.valid).toBe(true);

      // Third validation with invalid data - should still use cached schema
      const data3 = { username: "user3" }; // missing email
      const result3 = validateWithSchema(schema, data3);
      expect(result3.valid).toBe(false);
    });

    it("should handle multiple different schemas with different $id values", () => {
      const schema1 = {
        $id: "https://example.com/schema1.json",
        type: "object",
        properties: { field1: { type: "string" } },
        required: ["field1"],
      };

      const schema2 = {
        $id: "https://example.com/schema2.json",
        type: "object",
        properties: { field2: { type: "number" } },
        required: ["field2"],
      };

      // Validate with first schema
      const result1 = validateWithSchema(schema1, { field1: "test" });
      expect(result1.valid).toBe(true);

      // Validate with second schema
      const result2 = validateWithSchema(schema2, { field2: 42 });
      expect(result2.valid).toBe(true);

      // Validate again with first schema (cached)
      const result3 = validateWithSchema(schema1, { field1: "test2" });
      expect(result3.valid).toBe(true);

      // Validate again with second schema (cached)
      const result4 = validateWithSchema(schema2, { field2: 100 });
      expect(result4.valid).toBe(true);
    });
  });

  describe("schema without $id", () => {
    it("should handle schemas without $id", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      // Multiple validations with schema without $id should work
      const result1 = validateWithSchema(schema, { name: "test1" });
      expect(result1.valid).toBe(true);

      const result2 = validateWithSchema(schema, { name: "test2" });
      expect(result2.valid).toBe(true);
    });
  });

  describe("error reporting", () => {
    it("should return detailed errors for validation failures", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", minLength: 3 },
          age: { type: "number", minimum: 0 },
        },
        required: ["name", "age"],
      };

      const data = { name: "Jo", age: -5 };
      const result = validateWithSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
