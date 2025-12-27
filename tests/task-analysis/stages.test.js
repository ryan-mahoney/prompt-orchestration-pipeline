import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../../src/task-analysis/parser.js";
import { extractStages } from "../../src/task-analysis/extractors/stages.js";

describe("extractStages", () => {
  it("extracts correct names from exported functions", () => {
    const code = `
      export function ingestion() {
        return "data";
      }

      export function processing() {
        return "processed";
      }

      export function output() {
        return "result";
      }
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(3);
    expect(stages.map((s) => s.name)).toEqual([
      "ingestion",
      "processing",
      "output",
    ]);
  });

  it("extracts names from exported arrow functions", () => {
    const code = `
      export const ingestion = () => {
        return "data";
      };

      export const processing = () => {
        return "processed";
      };

      export const output = () => {
        return "result";
      };
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(3);
    expect(stages.map((s) => s.name)).toEqual([
      "ingestion",
      "processing",
      "output",
    ]);
  });

  it("orders stages by line number", () => {
    const code = `
      export function third() { return 3; }
      export function first() { return 1; }
      export function second() { return 2; }
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(3);
    expect(stages[0].name).toBe("third");
    expect(stages[1].name).toBe("first");
    expect(stages[2].name).toBe("second");
    expect(stages[0].order).toBeLessThan(stages[1].order);
    expect(stages[1].order).toBeLessThan(stages[2].order);
  });

  it("correctly identifies async functions", () => {
    const code = `
      export function syncStage() {
        return "sync";
      }

      export async function asyncStage() {
        return await Promise.resolve("async");
      }

      export const syncArrow = () => {
        return "sync arrow";
      };

      export const asyncArrow = async () => {
        return await Promise.resolve("async arrow");
      };
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(4);

    const syncStage = stages.find((s) => s.name === "syncStage");
    expect(syncStage.isAsync).toBe(false);

    const asyncStage = stages.find((s) => s.name === "asyncStage");
    expect(asyncStage.isAsync).toBe(true);

    const syncArrow = stages.find((s) => s.name === "syncArrow");
    expect(syncArrow.isAsync).toBe(false);

    const asyncArrow = stages.find((s) => s.name === "asyncArrow");
    expect(asyncArrow.isAsync).toBe(true);
  });

  it("ignores non-exported functions", () => {
    const code = `
      function notExported() {
        return "ignored";
      }

      export function exported() {
        return "included";
      }

      const alsoNotExported = () => {
        return "ignored";
      };

      export const alsoExported = () => {
        return "included";
      };
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(2);
    expect(stages.map((s) => s.name)).toEqual(["exported", "alsoExported"]);
  });

  it("ignores non-function exports", () => {
    const code = `
      export const CONFIG = { key: "value" };
      export const NUMBER = 42;
      export const STRING = "test";
      export const ARRAY = [1, 2, 3];

      export function validStage() {
        return "included";
      }
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(1);
    expect(stages[0].name).toBe("validStage");
  });

  it("returns empty array for code without exports", () => {
    const code = `
      const local = "value";
      function notExported() {
        return "ignored";
      }
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toEqual([]);
  });

  it("handles mixed function and arrow function exports", () => {
    const code = `
      export function regularFunction() {
        return "regular";
      }

      export const arrowFunction = () => {
        return "arrow";
      };

      export async function asyncRegularFunction() {
        return await "async regular";
      }

      export const asyncArrowFunction = async () => {
        return await "async arrow";
      };
    `;

    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(4);
    expect(stages.map((s) => s.name)).toEqual([
      "regularFunction",
      "arrowFunction",
      "asyncRegularFunction",
      "asyncArrowFunction",
    ]);

    expect(stages[0].isAsync).toBe(false);
    expect(stages[1].isAsync).toBe(false);
    expect(stages[2].isAsync).toBe(true);
    expect(stages[3].isAsync).toBe(true);
  });

  it("sets order to 0 when location is not available", () => {
    const code = `
      export function test() {
        return "test";
      }
    `;

    const ast = parseTaskSource(code);
    // Manually remove location to test fallback
    ast.program.body[0].loc = null;

    const stages = extractStages(ast);

    expect(stages).toHaveLength(1);
    expect(stages[0].order).toBe(0);
  });
});
