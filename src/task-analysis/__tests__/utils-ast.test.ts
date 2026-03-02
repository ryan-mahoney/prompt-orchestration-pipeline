import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type { CallExpression } from "@babel/types";
import { isInsideTryCatch, getStageName } from "../utils/ast.js";

function findReadArtifactPath(code: string): NodePath<CallExpression> | null {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  let captured: NodePath<CallExpression> | null = null;

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        callee.type === "MemberExpression" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "readArtifact"
      ) {
        captured = path;
      }
    },
  });

  return captured;
}

describe("isInsideTryCatch", () => {
  it("returns true when call is inside a try block", () => {
    const code = `
      export async function myStage() {
        try {
          io.readArtifact("x")
        } catch(e) {}
      }
    `;
    const path = findReadArtifactPath(code);
    expect(path).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(isInsideTryCatch(path!)).toBe(true);
  });

  it("returns false when call is outside a try block", () => {
    const code = `
      export async function myStage() {
        io.readArtifact("x")
      }
    `;
    const path = findReadArtifactPath(code);
    expect(path).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(isInsideTryCatch(path!)).toBe(false);
  });
});

describe("getStageName", () => {
  it("returns the stage name for a call inside an exported function", () => {
    const code = `
      export async function myStage() {
        try {
          io.readArtifact("x")
        } catch(e) {}
      }
    `;
    const path = findReadArtifactPath(code);
    expect(path).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(getStageName(path!)).toBe("myStage");
  });

  it("returns null when call is not inside an exported function", () => {
    const code = `
      async function notExported() {
        io.readArtifact("x")
      }
    `;
    const path = findReadArtifactPath(code);
    expect(path).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(getStageName(path!)).toBeNull();
  });
});
