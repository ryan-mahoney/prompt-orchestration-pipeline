import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../../src/task-analysis/parser.js";

describe("parseTaskSource", () => {
  it("parses valid ESM code with exports", () => {
    const code = `
      export function ingestion() {
        return "data";
      }

      export async function inference() {
        return await fetch("data");
      }
    `;

    const ast = parseTaskSource(code);
    expect(ast).toBeDefined();
    expect(ast.type).toBe("File");
    expect(ast.program).toBeDefined();
  });

  it("parses code with async functions", () => {
    const code = `
      export async function asyncStage() {
        return Promise.resolve("result");
      }
    `;

    const ast = parseTaskSource(code);
    expect(ast).toBeDefined();
  });

  it("parses code with arrow functions", () => {
    const code = `
      export const arrowStage = () => {
        return "arrow result";
      };
    `;

    const ast = parseTaskSource(code);
    expect(ast).toBeDefined();
  });

  it("parses code with template literals", () => {
    const code = `
      export function templateStage() {
        const name = "test";
        return \`result: \${name}\`;
      }
    `;

    const ast = parseTaskSource(code);
    expect(ast).toBeDefined();
  });

  it("parses JSX code", () => {
    const code = `
      export const jsxStage = () => {
        return <div>Hello</div>;
      };
    `;

    const ast = parseTaskSource(code);
    expect(ast).toBeDefined();
  });

  it("throws error on invalid syntax - missing closing brace", () => {
    const code = `
      export function brokenStage() {
        return "data";
    `;

    expect(() => parseTaskSource(code)).toThrow();
    expect(() => parseTaskSource(code)).toThrow(
      /Failed to parse task source code/
    );
  });

  it("throws error on invalid syntax - unexpected token", () => {
    const code = `
      export function brokenStage() {
        const obj = { name: "test" }
        return obj.name.
      }
    `;

    expect(() => parseTaskSource(code)).toThrow();
    expect(() => parseTaskSource(code)).toThrow(
      /Failed to parse task source code/
    );
  });

  it("includes error location in thrown error", () => {
    const code = `
      export function brokenStage() {
        return "data";
    `;

    try {
      parseTaskSource(code);
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.message).toMatch(/line \d+, column \d+/);
    }
  });

  it("throws error with original error as cause", () => {
    const code = `
      export function brokenStage() {
        return "data";
    `;

    try {
      parseTaskSource(code);
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.cause).toBeDefined();
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});
