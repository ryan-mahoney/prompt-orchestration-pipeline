import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../../src/task-analysis/parser.js";
import {
  extractArtifactReads,
  extractArtifactWrites,
} from "../../src/task-analysis/extractors/artifacts.js";

describe("extractArtifactReads", () => {
  it("finds io.readArtifact with string literal", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact("file.json");
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      fileName: "file.json",
      stage: "stageOne",
      required: true,
    });
  });

  it("sets required: true for non-wrapped calls", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact("file.json");
        return data;
      }

      export function stageTwo({ io }) {
        const more = io.readArtifact("other.json");
        return more;
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(2);
    expect(reads.every((r) => r.required)).toBe(true);
  });

  it("sets required: false for try/catch wrapped calls", () => {
    const code = `
      export function stageOne({ io }) {
        try {
          const data = io.readArtifact("file.json");
          return data;
        } catch (e) {
          return null;
        }
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].required).toBe(false);
  });

  it("extracts template literals as-is", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact(\`file-\${name}.json\`);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].fileName).toBe("file-.json");
  });

  it("extracts simple template literal without expressions", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact(\`file.json\`);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].fileName).toBe("file.json");
  });

  it("throws error for non-string literal argument", () => {
    const code = `
      export function stageOne({ io }) {
        const filename = "file.json";
        const data = io.readArtifact(filename);
        return data;
      }
    `;

    const ast = parseTaskSource(code);

    expect(() => extractArtifactReads(ast)).toThrow(
      "requires a string literal or template literal"
    );
  });

  it("throws error for call outside exported function", () => {
    const code = `
      io.readArtifact("file.json");
    `;

    const ast = parseTaskSource(code);

    expect(() => extractArtifactReads(ast)).toThrow(
      "outside an exported function"
    );
  });

  it("returns empty array for code without artifact reads", () => {
    const code = `
      export function stageOne() {
        return "data";
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toEqual([]);
  });

  it("handles multiple reads in same stage", () => {
    const code = `
      export function stageOne({ io }) {
        const data1 = io.readArtifact("file1.json");
        const data2 = io.readArtifact("file2.json");
        const data3 = io.readArtifact("file3.json");
        return [data1, data2, data3];
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(3);
    expect(reads.map((r) => r.fileName)).toEqual([
      "file1.json",
      "file2.json",
      "file3.json",
    ]);
  });

  it("handles nested try/catch correctly", () => {
    const code = `
      export function stageOne({ io }) {
        try {
          if (condition) {
            const data = io.readArtifact("file.json");
            return data;
          }
        } catch (e) {
          return null;
        }
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].required).toBe(false);
  });
});

describe("extractArtifactWrites", () => {
  it("finds io.writeArtifact with string literal", () => {
    const code = `
      export function stageOne({ io }) {
        const data = { result: "success" };
        io.writeArtifact("output.json", data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const writes = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      fileName: "output.json",
      stage: "stageOne",
    });
  });

  it("extracts filename only, ignores second argument", () => {
    const code = `
      export function stageOne({ io }) {
        const data = { result: "success" };
        io.writeArtifact("output.json", data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const writes = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0].fileName).toBe("output.json");
    expect(writes[0]).not.toHaveProperty("data");
  });

  it("extracts template literals as-is", () => {
    const code = `
      export function stageOne({ io }) {
        const data = { result: "success" };
        io.writeArtifact(\`output-\${timestamp}.json\`, data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const writes = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0].fileName).toBe("output-.json");
  });

  it("throws error for non-string literal argument", () => {
    const code = `
      export function stageOne({ io }) {
        const filename = "output.json";
        const data = { result: "success" };
        io.writeArtifact(filename, data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);

    expect(() => extractArtifactWrites(ast)).toThrow(
      "requires a string literal or template literal"
    );
  });

  it("throws error for call outside exported function", () => {
    const code = `
      io.writeArtifact("output.json", {});
    `;

    const ast = parseTaskSource(code);

    expect(() => extractArtifactWrites(ast)).toThrow(
      "outside an exported function"
    );
  });

  it("returns empty array for code without artifact writes", () => {
    const code = `
      export function stageOne() {
        return "data";
      }
    `;

    const ast = parseTaskSource(code);
    const writes = extractArtifactWrites(ast);

    expect(writes).toEqual([]);
  });

  it("handles multiple writes in same stage", () => {
    const code = `
      export function stageOne({ io }) {
        io.writeArtifact("file1.json", { a: 1 });
        io.writeArtifact("file2.json", { b: 2 });
        io.writeArtifact("file3.json", { c: 3 });
        return "done";
      }
    `;

    const ast = parseTaskSource(code);
    const writes = extractArtifactWrites(ast);

    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.fileName)).toEqual([
      "file1.json",
      "file2.json",
      "file3.json",
    ]);
  });

  it("handles both reads and writes in same file", () => {
    const code = `
      export function readStage({ io }) {
        const data = io.readArtifact("input.json");
        return data;
      }

      export function writeStage({ io }) {
        io.writeArtifact("output.json", { result: "done" });
        return "done";
      }
    `;

    const ast = parseTaskSource(code);
    const reads = extractArtifactReads(ast);
    const writes = extractArtifactWrites(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      fileName: "input.json",
      stage: "readStage",
      required: true,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      fileName: "output.json",
      stage: "writeStage",
    });
  });
});
