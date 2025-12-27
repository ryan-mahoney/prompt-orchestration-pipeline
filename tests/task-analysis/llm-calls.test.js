import { describe, it, expect } from "vitest";
import { parseTaskSource } from "../../src/task-analysis/parser.js";
import { extractLLMCalls } from "../../src/task-analysis/extractors/llm-calls.js";

describe("extractLLMCalls", () => {
  it("should extract llm.deepseek.chat call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        await llm.deepseek.chat({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "inference",
    });
  });

  it("should extract llm.openai.gpt5Mini call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        await llm.openai.gpt5Mini({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "inference",
    });
  });

  it("should extract llm.anthropic.sonnet45 call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        await llm.anthropic.sonnet45({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "anthropic",
      method: "sonnet45",
      stage: "inference",
    });
  });

  it("should extract llm.gemini.flash25 call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        await llm.gemini.flash25({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "gemini",
      method: "flash25",
      stage: "inference",
    });
  });

  it("should extract multiple LLM calls from same stage", () => {
    const code = `
      export const inference = async ({ llm }) => {
        await llm.deepseek.chat({ messages: [] });
        await llm.openai.gpt5Mini({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "inference",
    });
    expect(calls[1]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "inference",
    });
  });

  it("should extract LLM calls from different stages", () => {
    const code = `
      export const stage1 = async ({ llm }) => {
        await llm.deepseek.chat({ messages: [] });
      };

      export const stage2 = async ({ llm }) => {
        await llm.openai.gpt5Mini({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "stage1",
    });
    expect(calls[1]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "stage2",
    });
  });

  it("should return empty array for code without LLM calls", () => {
    const code = `
      export const stage = async ({ io }) => {
        const content = await io.readArtifact("file.json");
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(0);
  });

  it("should throw error for LLM call outside exported function", () => {
    const code = `
      await llm.deepseek.chat({ messages: [] });
    `;

    const ast = parseTaskSource(code);

    expect(() => extractLLMCalls(ast)).toThrow(
      /LLM call found outside an exported function/
    );
  });

  it("should handle sync function stages", () => {
    const code = `
      export const stage = ({ llm }) => {
        llm.deepseek.chat({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "stage",
    });
  });

  it("should extract destructured llm.deepseek.chat call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        const { deepseek } = llm;
        await deepseek.chat({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "inference",
    });
  });

  it("should extract destructured llm.openai.gpt5Mini call", () => {
    const code = `
      export const inference = async ({ llm }) => {
        const { openai } = llm;
        await openai.gpt5Mini({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "inference",
    });
  });

  it("should extract multiple destructured providers", () => {
    const code = `
      export const inference = async ({ llm }) => {
        const { deepseek, openai } = llm;
        await deepseek.chat({ messages: [] });
        await openai.gpt5Mini({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "inference",
    });
    expect(calls[1]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "inference",
    });
  });

  it("should mix direct and destructured calls", () => {
    const code = `
      export const inference = async ({ llm }) => {
        const { deepseek } = llm;
        await llm.openai.gpt5Mini({ messages: [] });
        await deepseek.chat({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      provider: "openai",
      method: "gpt5Mini",
      stage: "inference",
    });
    expect(calls[1]).toEqual({
      provider: "deepseek",
      method: "chat",
      stage: "inference",
    });
  });

  it("should not extract non-destructured provider calls", () => {
    const code = `
      export const inference = async ({ llm, data }) => {
        const { deepseek } = data;
        await deepseek.chat({ messages: [] });
      };
    `;

    const ast = parseTaskSource(code);
    const calls = extractLLMCalls(ast);

    expect(calls).toHaveLength(0);
  });
});
