import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../parser.js";
import { extractStages } from "../extractors/stages.js";

describe("extractStages", () => {
  it("extracts async and non-async function declaration exports with correct order", () => {
    const code = `
export async function ingestion() {}
export function parsing() {}
    `.trim();
    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(2);

    const ingestion = stages.find((s) => s.name === "ingestion");
    const parsing = stages.find((s) => s.name === "parsing");

    expect(ingestion).toBeDefined();
    expect(ingestion?.isAsync).toBe(true);

    expect(parsing).toBeDefined();
    expect(parsing?.isAsync).toBe(false);

    // ascending order: ingestion comes before parsing
    const ingestionIdx = stages.indexOf(ingestion!);
    const parsingIdx = stages.indexOf(parsing!);
    expect(ingestionIdx).toBeLessThan(parsingIdx);
  });

  it("detects async arrow function export as an async stage", () => {
    const code = `export const refine = async () => {}`;
    const ast = parseTaskSource(code);
    const stages = extractStages(ast);

    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("refine");
    expect(stages[0]?.isAsync).toBe(true);
  });

  it("returns empty array when there are no exports", () => {
    const code = `function internal() {}`;
    const ast = parseTaskSource(code);
    expect(extractStages(ast)).toEqual([]);
  });

  it("ignores non-function exports", () => {
    const code = `export const FOO = 42;`;
    const ast = parseTaskSource(code);
    expect(extractStages(ast)).toEqual([]);
  });
});
