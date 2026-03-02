import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../parser.js";

describe("parseTaskSource", () => {
  it("parses valid ESM code and returns a File node with a body", () => {
    const result = parseTaskSource("export function foo() {}");
    expect(result.type).toBe("File");
    expect(result.program.body.length).toBeGreaterThan(0);
  });

  it("parses valid JSX code without error", () => {
    const result = parseTaskSource(
      "export function Comp() { return <div /> }",
    );
    expect(result.type).toBe("File");
  });

  it("throws an Error with line/column info and cause on invalid code", () => {
    expect(() => parseTaskSource("export function {")).toThrow(Error);
    try {
      parseTaskSource("export function {");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toMatch(/line \d+, column \d+/);
      expect((err as Error).cause).toBeDefined();
    }
  });
});

describe("Babel import interop smoke test", () => {
  it("@babel/traverse default import is a function", async () => {
    const { default: traverse } = await import("@babel/traverse");
    expect(typeof traverse).toBe("function");
  });

  it("@babel/generator default import is a function", async () => {
    const { default: generate } = await import("@babel/generator");
    expect(typeof generate).toBe("function");
  });
});
