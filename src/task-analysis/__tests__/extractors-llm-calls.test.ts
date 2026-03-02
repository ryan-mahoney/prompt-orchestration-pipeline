import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../parser.js";
import { extractLLMCalls } from "../extractors/llm-calls.js";

describe("extractLLMCalls", () => {
  it("detects direct llm.provider.method() access", () => {
    const code = `export function s() { llm.deepseek.chat({}) }`;
    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "deepseek", method: "chat", stage: "s" });
  });

  it("detects variable-destructured pattern: const { provider } = llm", () => {
    const code = `export function s() { const { openai } = llm; openai.gpt5({}) }`;
    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "openai", method: "gpt5", stage: "s" });
  });

  it("detects parameter-destructured pattern: ({ llm: { provider } })", () => {
    const code = `export function s({ llm: { anthropic } }) { anthropic.sonnet45({}) }`;
    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "anthropic", method: "sonnet45", stage: "s" });
  });

  it("does not produce a ModelCall for a same-named identifier in a different scope", () => {
    const code = `const deepseek = {}; deepseek.chat({})`;
    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(0);
  });

  it("throws when llm.provider.method() is outside an exported function", () => {
    const code = `function internal() { llm.openai.chat({}) }`;
    const ast = parseTaskSource(code);
    expect(() => extractLLMCalls(ast)).toThrow();
  });
});
