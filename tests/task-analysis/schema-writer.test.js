import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeSchemaFiles } from "../../src/task-analysis/enrichers/schema-writer.js";
import { createTempDir, cleanupTempDir } from "../test-utils.js";

describe("writeSchemaFiles", () => {
  let tempDir;
  let pipelinePath;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pipelinePath = path.join(tempDir, "pipeline");
    await fs.mkdir(pipelinePath, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("basic file writing", () => {
    it("creates schema, sample, and meta files", async () => {
      const artifactName = "output.json";
      const deducedData = {
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        example: { title: "Test" },
        reasoning: "Simple test schema",
      };

      await writeSchemaFiles(pipelinePath, artifactName, deducedData);

      const schemasDir = path.join(pipelinePath, "schemas");
      const schemaFile = path.join(schemasDir, "output.schema.json");
      const sampleFile = path.join(schemasDir, "output.sample.json");
      const metaFile = path.join(schemasDir, "output.meta.json");

      // Verify all files exist
      await expect(fs.stat(schemaFile)).resolves.toBeDefined();
      await expect(fs.stat(sampleFile)).resolves.toBeDefined();
      await expect(fs.stat(metaFile)).resolves.toBeDefined();

      // Verify schema content
      const schemaContent = JSON.parse(await fs.readFile(schemaFile, "utf-8"));
      expect(schemaContent).toEqual(deducedData.schema);

      // Verify sample content
      const sampleContent = JSON.parse(await fs.readFile(sampleFile, "utf-8"));
      expect(sampleContent).toEqual(deducedData.example);

      // Verify meta content
      const metaContent = JSON.parse(await fs.readFile(metaFile, "utf-8"));
      expect(metaContent.source).toBe("llm-deduction");
      expect(metaContent.reasoning).toBe(deducedData.reasoning);
      expect(metaContent.generatedAt).toBeDefined();
      expect(new Date(metaContent.generatedAt)).toBeInstanceOf(Date);
    });

    it("writes pure JSON Schema without extra keys", async () => {
      const deducedData = {
        schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        },
        example: { name: "Alice", age: 30 },
        reasoning: "Test schema with required fields",
      };

      await writeSchemaFiles(pipelinePath, "user.json", deducedData);

      const schemaFile = path.join(pipelinePath, "schemas", "user.schema.json");
      const schemaContent = JSON.parse(await fs.readFile(schemaFile, "utf-8"));

      // Verify only schema properties are present (no metadata mixed in)
      expect(schemaContent).toEqual(deducedData.schema);
      expect(schemaContent).not.toHaveProperty("reasoning");
      expect(schemaContent).not.toHaveProperty("generatedAt");
    });

    it("formats JSON files with proper indentation", async () => {
      const deducedData = {
        schema: { type: "string" },
        example: "test",
        reasoning: "Simple string schema",
      };

      await writeSchemaFiles(pipelinePath, "text.json", deducedData);

      const schemaFile = path.join(pipelinePath, "schemas", "text.schema.json");
      const content = await fs.readFile(schemaFile, "utf-8");

      // Verify proper JSON formatting with 2-space indentation
      expect(content).toContain("{\n  ");
      expect(content).toBe(JSON.stringify(deducedData.schema, null, 2));
    });
  });

  describe("directory creation", () => {
    it("creates schemas directory if it doesn't exist", async () => {
      const schemasDir = path.join(pipelinePath, "schemas");

      // Verify directory doesn't exist yet
      await expect(fs.stat(schemasDir)).rejects.toThrow();

      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      // Verify directory was created
      const stats = await fs.stat(schemasDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("uses existing schemas directory if it already exists", async () => {
      const schemasDir = path.join(pipelinePath, "schemas");
      await fs.mkdir(schemasDir, { recursive: true });

      // Create a marker file
      const markerFile = path.join(schemasDir, "existing.txt");
      await fs.writeFile(markerFile, "existing content");

      await writeSchemaFiles(pipelinePath, "new.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      // Verify existing file is still there
      const markerContent = await fs.readFile(markerFile, "utf-8");
      expect(markerContent).toBe("existing content");

      // Verify new files were created
      await expect(
        fs.stat(path.join(schemasDir, "new.schema.json"))
      ).resolves.toBeDefined();
    });

    it("creates nested directory structure when parent directories don't exist", async () => {
      // Use a deeply nested pipeline path that doesn't exist
      const deepPath = path.join(tempDir, "a", "b", "c", "pipeline");

      // Path doesn't exist yet
      await expect(fs.stat(deepPath)).rejects.toThrow();

      await writeSchemaFiles(deepPath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      // Verify entire path was created
      const schemasDir = path.join(deepPath, "schemas");
      const stats = await fs.stat(schemasDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("path handling and baseName extraction", () => {
    it("extracts baseName from simple filename", async () => {
      await writeSchemaFiles(pipelinePath, "output.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, "output.schema.json"))
      ).resolves.toBeDefined();
    });

    it("extracts baseName from filename with multiple extensions", async () => {
      await writeSchemaFiles(pipelinePath, "data.backup.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      // Should use "data.backup" as baseName (only removes last extension)
      await expect(
        fs.stat(path.join(schemasDir, "data.backup.schema.json"))
      ).resolves.toBeDefined();
    });

    it("handles filename without extension", async () => {
      await writeSchemaFiles(pipelinePath, "output", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, "output.schema.json"))
      ).resolves.toBeDefined();
    });

    it("handles filename with leading dot (hidden file)", async () => {
      await writeSchemaFiles(pipelinePath, ".config.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, ".config.schema.json"))
      ).resolves.toBeDefined();
    });

    it("handles filename with special characters", async () => {
      await writeSchemaFiles(pipelinePath, "my-output_v2.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, "my-output_v2.schema.json"))
      ).resolves.toBeDefined();
    });

    it("handles filename with path separators (uses only filename part)", async () => {
      // Even if artifactName contains path separators, should extract basename
      await writeSchemaFiles(pipelinePath, "subfolder/output.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, "output.schema.json"))
      ).resolves.toBeDefined();
    });
  });

  describe("metadata generation", () => {
    it("includes source field in metadata", async () => {
      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test reasoning",
      });

      const metaFile = path.join(pipelinePath, "schemas", "test.meta.json");
      const metaContent = JSON.parse(await fs.readFile(metaFile, "utf-8"));

      expect(metaContent.source).toBe("llm-deduction");
    });

    it("includes ISO 8601 timestamp in metadata", async () => {
      const beforeTime = new Date().toISOString();

      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "Test",
      });

      const afterTime = new Date().toISOString();

      const metaFile = path.join(pipelinePath, "schemas", "test.meta.json");
      const metaContent = JSON.parse(await fs.readFile(metaFile, "utf-8"));

      // Verify timestamp is valid ISO 8601 by parsing it
      expect(metaContent.generatedAt).toBeDefined();
      const generatedDate = new Date(metaContent.generatedAt);
      expect(generatedDate).toBeInstanceOf(Date);
      expect(isNaN(generatedDate.getTime())).toBe(false);

      // Verify timestamp is reasonable (between before and after)
      expect(metaContent.generatedAt >= beforeTime).toBe(true);
      expect(metaContent.generatedAt <= afterTime).toBe(true);
    });

    it("includes reasoning in metadata", async () => {
      const reasoning = "This is a detailed reasoning explanation";

      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning,
      });

      const metaFile = path.join(pipelinePath, "schemas", "test.meta.json");
      const metaContent = JSON.parse(await fs.readFile(metaFile, "utf-8"));

      expect(metaContent.reasoning).toBe(reasoning);
    });
  });

  describe("input validation", () => {
    it("throws on invalid deducedData parameter (null)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", null)
      ).rejects.toThrow(
        "Invalid deducedData: expected an object but got object"
      );
    });

    it("throws on invalid deducedData parameter (undefined)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", undefined)
      ).rejects.toThrow(
        "Invalid deducedData: expected an object but got undefined"
      );
    });

    it("throws on invalid deducedData parameter (string)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", "not an object")
      ).rejects.toThrow(
        "Invalid deducedData: expected an object but got string"
      );
    });

    it("throws on missing schema property", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          example: {},
          reasoning: "Test",
        })
      ).rejects.toThrow(
        "Invalid deducedData.schema: expected an object but got undefined"
      );
    });

    it("throws on invalid schema property (string)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          schema: "not an object",
          example: {},
          reasoning: "Test",
        })
      ).rejects.toThrow(
        "Invalid deducedData.schema: expected an object but got string"
      );
    });

    it("throws on missing example property (undefined)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          schema: { type: "object" },
          reasoning: "Test",
        })
      ).rejects.toThrow(
        "Invalid deducedData.example: expected a value but got undefined"
      );
    });

    it("throws on null example property", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          schema: { type: "object" },
          example: null,
          reasoning: "Test",
        })
      ).rejects.toThrow(
        "Invalid deducedData.example: expected a value but got null"
      );
    });

    it("throws on missing reasoning property", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          schema: { type: "object" },
          example: {},
        })
      ).rejects.toThrow(
        "Invalid deducedData.reasoning: expected a string but got undefined"
      );
    });

    it("throws on invalid reasoning property (number)", async () => {
      await expect(
        writeSchemaFiles(pipelinePath, "test.json", {
          schema: { type: "object" },
          example: {},
          reasoning: 123,
        })
      ).rejects.toThrow(
        "Invalid deducedData.reasoning: expected a string but got number"
      );
    });

    it("allows primitive values for example (string)", async () => {
      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "string" },
        example: "test value",
        reasoning: "Test",
      });

      const sampleFile = path.join(pipelinePath, "schemas", "test.sample.json");
      const sampleContent = JSON.parse(await fs.readFile(sampleFile, "utf-8"));
      expect(sampleContent).toBe("test value");
    });

    it("allows primitive values for example (number)", async () => {
      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "number" },
        example: 42,
        reasoning: "Test",
      });

      const sampleFile = path.join(pipelinePath, "schemas", "test.sample.json");
      const sampleContent = JSON.parse(await fs.readFile(sampleFile, "utf-8"));
      expect(sampleContent).toBe(42);
    });

    it("allows empty string for reasoning", async () => {
      await writeSchemaFiles(pipelinePath, "test.json", {
        schema: { type: "object" },
        example: {},
        reasoning: "",
      });

      const metaFile = path.join(pipelinePath, "schemas", "test.meta.json");
      const metaContent = JSON.parse(await fs.readFile(metaFile, "utf-8"));
      expect(metaContent.reasoning).toBe("");
    });
  });

  describe("error scenarios", () => {
    it("propagates errors from filesystem operations", async () => {
      // Create a file where we want to create a directory
      const conflictPath = path.join(tempDir, "conflict");
      await fs.writeFile(conflictPath, "I am a file");

      // Try to use this file as a pipeline directory (should fail)
      await expect(
        writeSchemaFiles(conflictPath, "test.json", {
          schema: { type: "object" },
          example: {},
          reasoning: "Test",
        })
      ).rejects.toThrow();
    });

    it("handles empty schema data", async () => {
      await writeSchemaFiles(pipelinePath, "empty.json", {
        schema: {},
        example: {},
        reasoning: "",
      });

      const schemaFile = path.join(
        pipelinePath,
        "schemas",
        "empty.schema.json"
      );
      const schemaContent = JSON.parse(await fs.readFile(schemaFile, "utf-8"));
      expect(schemaContent).toEqual({});
    });

    it("handles complex nested schema structures", async () => {
      const complexSchema = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              address: {
                type: "object",
                properties: {
                  street: { type: "string" },
                  city: { type: "string" },
                  coordinates: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                    },
                  },
                },
              },
            },
          },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      };

      await writeSchemaFiles(pipelinePath, "complex.json", {
        schema: complexSchema,
        example: {
          user: {
            name: "Test",
            address: {
              street: "123 Main",
              city: "City",
              coordinates: { lat: 0, lng: 0 },
            },
          },
          tags: ["tag1", "tag2"],
        },
        reasoning: "Complex nested structure",
      });

      const schemaFile = path.join(
        pipelinePath,
        "schemas",
        "complex.schema.json"
      );
      const schemaContent = JSON.parse(await fs.readFile(schemaFile, "utf-8"));

      expect(schemaContent).toEqual(complexSchema);
    });
  });

  describe("multiple invocations", () => {
    it("overwrites existing files on subsequent calls", async () => {
      const firstData = {
        schema: { type: "string" },
        example: "first",
        reasoning: "First version",
      };

      await writeSchemaFiles(pipelinePath, "test.json", firstData);

      const secondData = {
        schema: { type: "number" },
        example: 42,
        reasoning: "Second version",
      };

      await writeSchemaFiles(pipelinePath, "test.json", secondData);

      // Verify files contain second version
      const schemaFile = path.join(pipelinePath, "schemas", "test.schema.json");
      const schemaContent = JSON.parse(await fs.readFile(schemaFile, "utf-8"));
      expect(schemaContent).toEqual(secondData.schema);

      const sampleFile = path.join(pipelinePath, "schemas", "test.sample.json");
      const sampleContent = JSON.parse(await fs.readFile(sampleFile, "utf-8"));
      expect(sampleContent).toEqual(secondData.example);
    });

    it("can write multiple artifacts independently", async () => {
      await writeSchemaFiles(pipelinePath, "artifact1.json", {
        schema: { type: "string" },
        example: "test1",
        reasoning: "First",
      });

      await writeSchemaFiles(pipelinePath, "artifact2.json", {
        schema: { type: "number" },
        example: 42,
        reasoning: "Second",
      });

      // Verify both sets of files exist
      const schemasDir = path.join(pipelinePath, "schemas");
      await expect(
        fs.stat(path.join(schemasDir, "artifact1.schema.json"))
      ).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(schemasDir, "artifact2.schema.json"))
      ).resolves.toBeDefined();

      // Verify they have different content
      const schema1 = JSON.parse(
        await fs.readFile(
          path.join(schemasDir, "artifact1.schema.json"),
          "utf-8"
        )
      );
      const schema2 = JSON.parse(
        await fs.readFile(
          path.join(schemasDir, "artifact2.schema.json"),
          "utf-8"
        )
      );

      expect(schema1.type).toBe("string");
      expect(schema2.type).toBe("number");
    });
  });
});
