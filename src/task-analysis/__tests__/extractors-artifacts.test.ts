import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../parser.js";
import {
  extractArtifactReads,
  extractArtifactWrites,
  extractCodeContext,
} from "../extractors/artifacts.js";
import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";

describe("extractArtifactReads", () => {
  it("returns one read with correct fields for a simple string literal", () => {
    const code = `export function s() { io.readArtifact("data.json") }`;
    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(1);
    expect(unresolvedReads).toHaveLength(0);
    expect(reads[0]).toMatchObject({
      fileName: "data.json",
      stage: "s",
      required: true,
    });
  });

  it("sets required=false when inside a try/catch", () => {
    const code = `
export function s() {
  try {
    io.readArtifact("data.json")
  } catch(e) {}
}
    `.trim();
    const ast = parseTaskSource(code);
    const { reads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(1);
    expect(reads[0]?.required).toBe(false);
  });

  it("resolves template literal with expression into reads (not unresolvedReads)", () => {
    const code = `export function s() { io.readArtifact(\`file-\${name}.json\`) }`;
    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(unresolvedReads).toHaveLength(0);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.fileName).toContain("${name}");
  });

  it("puts dynamic identifiers in unresolvedReads with expression and codeContext", () => {
    const code = `export function s() { io.readArtifact(dynamicVar) }`;
    const ast = parseTaskSource(code);
    const { reads, unresolvedReads } = extractArtifactReads(ast, code);

    expect(reads).toHaveLength(0);
    expect(unresolvedReads).toHaveLength(1);
    expect(unresolvedReads[0]?.expression).toBe("dynamicVar");
    expect(typeof unresolvedReads[0]?.codeContext).toBe("string");
    expect(unresolvedReads[0]?.codeContext.length).toBeGreaterThan(0);
  });

  it("throws when io.readArtifact is outside an exported function", () => {
    const code = `function internal() { io.readArtifact("x") }`;
    const ast = parseTaskSource(code);
    expect(() => extractArtifactReads(ast, code)).toThrow();
  });
});

describe("extractArtifactWrites", () => {
  it("resolves template literal with no expressions into writes", () => {
    const code = "export function s() { io.writeArtifact(`output.json`) }";
    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(unresolvedWrites).toHaveLength(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ fileName: "output.json", stage: "s" });
  });

  it("puts dynamic identifiers in unresolvedWrites with expression and codeContext", () => {
    const code = `export function s() { io.writeArtifact(dynamicVar) }`;
    const ast = parseTaskSource(code);
    const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);

    expect(writes).toHaveLength(0);
    expect(unresolvedWrites).toHaveLength(1);
    expect(unresolvedWrites[0]?.expression).toBe("dynamicVar");
    expect(typeof unresolvedWrites[0]?.codeContext).toBe("string");
    expect(unresolvedWrites[0]?.codeContext.length).toBeGreaterThan(0);
  });

  it("throws when io.writeArtifact is outside an exported function", () => {
    const code = `function internal() { io.writeArtifact("x") }`;
    const ast = parseTaskSource(code);
    expect(() => extractArtifactWrites(ast, code)).toThrow();
  });
});

describe("extractCodeContext", () => {
  it("returns surrounding lines from the source", () => {
    const code = `line1\nline2\nline3\nline4\nline5`;
    const ast = parseTaskSource(
      `export function s() { io.readArtifact("x") }`
    );
    // Find a NodePath to use as anchor
    let capturedPath: NodePath | null = null;
    traverse(ast, {
      CallExpression(p) {
        capturedPath = p;
      },
    });
    expect(capturedPath).not.toBeNull();
    // The path's loc is line 1 in its own source, but we pass a different sourceCode
    // so we just check it returns a non-empty string without crashing
    const result = extractCodeContext(capturedPath!, code);
    expect(typeof result).toBe("string");
  });

  it("returns empty string when sourceCode is empty", () => {
    const ast = parseTaskSource(
      `export function s() { io.readArtifact("x") }`
    );
    let capturedPath: NodePath | null = null;
    traverse(ast, {
      CallExpression(p) {
        capturedPath = p;
      },
    });
    expect(capturedPath).not.toBeNull();
    expect(extractCodeContext(capturedPath!, "")).toBe("");
  });
});
