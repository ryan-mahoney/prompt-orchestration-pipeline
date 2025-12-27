import { describe, it, expect } from "vitest";
import traverse from "@babel/traverse";
import { parseTaskSource } from "../../src/task-analysis/parser.js";
import {
  isInsideTryCatch,
  getStageName,
} from "../../src/task-analysis/utils/ast.js";

describe("isInsideTryCatch", () => {
  it("returns true for code inside try/catch", () => {
    const code = `
      export function testStage() {
        try {
          const data = io.readArtifact("file.json");
        } catch (error) {
          console.error(error);
        }
      }
    `;

    const ast = parseTaskSource(code);
    let result = false;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          result = isInsideTryCatch(path);
        }
      },
    });

    expect(result).toBe(true);
  });

  it("returns false for code not inside try/catch", () => {
    const code = `
      export function testStage() {
        const data = io.readArtifact("file.json");
      }
    `;

    const ast = parseTaskSource(code);
    let result = true;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          result = isInsideTryCatch(path);
        }
      },
    });

    expect(result).toBe(false);
  });

  it("returns true for deeply nested code inside try/catch", () => {
    const code = `
      export function testStage() {
        try {
          if (true) {
            for (let i = 0; i < 10; i++) {
              const data = io.readArtifact("file.json");
            }
          }
        } catch (error) {
          console.error(error);
        }
      }
    `;

    const ast = parseTaskSource(code);
    let result = false;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          result = isInsideTryCatch(path);
        }
      },
    });

    expect(result).toBe(true);
  });

  it("returns false for code inside if statement but not try/catch", () => {
    const code = `
      export function testStage() {
        if (true) {
          const data = io.readArtifact("file.json");
        }
      }
    `;

    const ast = parseTaskSource(code);
    let result = true;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          result = isInsideTryCatch(path);
        }
      },
    });

    expect(result).toBe(false);
  });
});

describe("getStageName", () => {
  it("returns stage name for exported function declaration", () => {
    const code = `
      export function ingestion() {
        return io.readArtifact("file.json");
      }
    `;

    const ast = parseTaskSource(code);
    let stageName = null;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBe("ingestion");
  });

  it("returns stage name for exported const arrow function", () => {
    const code = `
      export const processing = () => {
        return io.readArtifact("file.json");
      };
    `;

    const ast = parseTaskSource(code);
    let stageName = null;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBe("processing");
  });

  it("returns null for non-exported function", () => {
    const code = `
      function internal() {
        return io.readArtifact("file.json");
      }

      export function exported() {
        return internal();
      }
    `;

    const ast = parseTaskSource(code);
    let stageName = "not null";

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBeNull();
  });

  it("returns null for code not in any function", () => {
    const code = `
      const data = io.readArtifact("file.json");
      export function exported() {
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    let stageName = "not null";

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBeNull();
  });

  it("returns correct stage name when multiple exports exist", () => {
    const code = `
      export function stage1() {
        return io.readArtifact("file1.json");
      }

      export function stage2() {
        return io.readArtifact("file2.json");
      }
    `;

    const ast = parseTaskSource(code);
    const stageNames = [];

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          const name = getStageName(path);
          if (name) stageNames.push(name);
        }
      },
    });

    expect(stageNames).toEqual(["stage1", "stage2"]);
  });

  it("returns stage name for async exported function", () => {
    const code = `
      export async function inference() {
        const data = await io.readArtifact("file.json");
        return data;
      }
    `;

    const ast = parseTaskSource(code);
    let stageName = null;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBe("inference");
  });

  it("returns stage name for exported const with function expression", () => {
    const code = `
      export const stage = function() {
        return io.readArtifact("file.json");
      };
    `;

    const ast = parseTaskSource(code);
    let stageName = null;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.object?.name === "io") {
          stageName = getStageName(path);
        }
      },
    });

    expect(stageName).toBe("stage");
  });
});
