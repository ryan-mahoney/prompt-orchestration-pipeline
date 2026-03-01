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
    const { reads, unresolvedReads } = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      fileName: "file.json",
      stage: "stageOne",
      required: true,
    });
    expect(unresolvedReads).toHaveLength(0);
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
    const { reads } = extractArtifactReads(ast);

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
    const { reads } = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].required).toBe(false);
  });

  it("extracts template literals with expressions preserved", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact(\`file-\${name}.json\`);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { reads } = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].fileName).toBe("file-${name}.json");
  });

  it("extracts simple template literal without expressions", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact(\`file.json\`);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { reads } = extractArtifactReads(ast);

    expect(reads).toHaveLength(1);
    expect(reads[0].fileName).toBe("file.json");
  });

  it("captures unresolved references for non-literal arguments", () => {
    const code = `
      export function stageOne({ io }) {
        const filename = "file.json";
        const data = io.readArtifact(filename);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(0);
    expect(unresolvedReads).toHaveLength(1);
    expect(unresolvedReads[0]).toMatchObject({
      expression: "filename",
      stage: "stageOne",
      required: true,
    });
    expect(unresolvedReads[0].location).toMatchObject({
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });

  it("captures function call arguments as unresolved", () => {
    const code = `
      export function stageOne({ io }) {
        const data = io.readArtifact(getInputFile());
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(0);
    expect(unresolvedReads).toHaveLength(1);
    expect(unresolvedReads[0]).toMatchObject({
      expression: "getInputFile()",
      stage: "stageOne",
      required: true,
    });
  });

  it("captures code context when sourceCode is provided", () => {
    const code = `export function stageOne({ io }) {
  const filename = "file.json";
  const data = io.readArtifact(filename);
  return data;
}`;

    const ast = parseTaskSource(code);
    const { unresolvedReads } = extractArtifactReads(ast, code);

    expect(unresolvedReads).toHaveLength(1);
    expect(unresolvedReads[0].codeContext).toContain(
      "io.readArtifact(filename)"
    );
    expect(unresolvedReads[0].codeContext).toContain("const filename");
  });

  it("handles mixed static and dynamic references", () => {
    const code = `
      export function stageOne({ io }) {
        const static1 = io.readArtifact("file1.json");
        const dynamic = io.readArtifact(dynamicName);
        const static2 = io.readArtifact("file2.json");
        return [static1, dynamic, static2];
      }
    `;

    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(2);
    expect(reads.map((r) => r.fileName)).toEqual(["file1.json", "file2.json"]);

    expect(unresolvedReads).toHaveLength(1);
    expect(unresolvedReads[0].expression).toBe("dynamicName");
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

  it("returns empty reads for code without artifact reads", () => {
    const code = `
      export function stageOne() {
        return "data";
      }
    `;

    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast);

    expect(reads).toHaveLength(0);
    expect(unresolvedReads).toHaveLength(0);
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
    const { reads } = extractArtifactReads(ast);

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
    const { reads } = extractArtifactReads(ast);

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
    const { writes, unresolvedWrites } = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      fileName: "output.json",
      stage: "stageOne",
    });
    expect(unresolvedWrites).toHaveLength(0);
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
    const { writes } = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0].fileName).toBe("output.json");
    expect(writes[0]).not.toHaveProperty("data");
  });

  it("extracts template literals with expressions preserved", () => {
    const code = `
      export function stageOne({ io }) {
        const data = { result: "success" };
        io.writeArtifact(\`output-\${timestamp}.json\`, data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { writes } = extractArtifactWrites(ast);

    expect(writes).toHaveLength(1);
    expect(writes[0].fileName).toBe("output-${timestamp}.json");
  });

  it("captures unresolved references for non-literal arguments", () => {
    const code = `
      export function stageOne({ io }) {
        const filename = "output.json";
        const data = { result: "success" };
        io.writeArtifact(filename, data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(writes).toHaveLength(0);
    expect(unresolvedWrites).toHaveLength(1);
    expect(unresolvedWrites[0]).toMatchObject({
      expression: "filename",
      stage: "stageOne",
    });
    expect(unresolvedWrites[0].location).toMatchObject({
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });

  it("captures function call arguments as unresolved", () => {
    const code = `
      export function stageOne({ io }) {
        const data = { result: "success" };
        io.writeArtifact(getOutputFile(), data);
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(writes).toHaveLength(0);
    expect(unresolvedWrites).toHaveLength(1);
    expect(unresolvedWrites[0]).toMatchObject({
      expression: "getOutputFile()",
      stage: "stageOne",
    });
  });

  it("captures code context when sourceCode is provided", () => {
    const code = `export function stageOne({ io }) {
  const filename = "output.json";
  const data = { result: "success" };
  io.writeArtifact(filename, data);
  return data;
}`;

    const ast = parseTaskSource(code);
    const { unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(unresolvedWrites).toHaveLength(1);
    expect(unresolvedWrites[0].codeContext).toContain(
      "io.writeArtifact(filename, data)"
    );
    expect(unresolvedWrites[0].codeContext).toContain("const filename");
  });

  it("handles mixed static and dynamic references", () => {
    const code = `
      export function stageOne({ io }) {
        io.writeArtifact("output1.json", { a: 1 });
        io.writeArtifact(dynamicName, { b: 2 });
        io.writeArtifact("output2.json", { c: 3 });
        return "done";
      }
    `;

    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.fileName)).toEqual([
      "output1.json",
      "output2.json",
    ]);

    expect(unresolvedWrites).toHaveLength(1);
    expect(unresolvedWrites[0].expression).toBe("dynamicName");
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

  it("returns empty arrays for code without artifact writes", () => {
    const code = `
      export function stageOne() {
        return "data";
      }
    `;

    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast);

    expect(writes).toHaveLength(0);
    expect(unresolvedWrites).toHaveLength(0);
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
    const { writes } = extractArtifactWrites(ast);

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
    const { reads } = extractArtifactReads(ast);
    const { writes } = extractArtifactWrites(ast);

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
