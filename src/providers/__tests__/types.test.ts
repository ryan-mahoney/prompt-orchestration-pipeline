import { describe, expect, it } from "vitest";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";

describe("ProviderJsonModeError", () => {
  it("is an instance of Error", () => {
    const err = new ProviderJsonModeError("anthropic");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets the provider property", () => {
    const err = new ProviderJsonModeError("openai");
    expect(err.provider).toBe("openai");
  });

  it("sets a default message when none is provided", () => {
    const err = new ProviderJsonModeError("gemini");
    expect(err.message).toContain("gemini");
    expect(err.message).toContain("valid JSON response format");
  });

  it("uses a custom message when provided", () => {
    const err = new ProviderJsonModeError("deepseek", "custom error message");
    expect(err.message).toBe("custom error message");
    expect(err.provider).toBe("deepseek");
  });

  it("has name set to ProviderJsonModeError", () => {
    const err = new ProviderJsonModeError("mock");
    expect(err.name).toBe("ProviderJsonModeError");
  });
});

describe("ProviderJsonParseError", () => {
  it("is an instance of Error", () => {
    const err = new ProviderJsonParseError("anthropic", "claude-3", "not json");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets the provider property", () => {
    const err = new ProviderJsonParseError("openai", "gpt-5", "bad output");
    expect(err.provider).toBe("openai");
  });

  it("sets the model property", () => {
    const err = new ProviderJsonParseError("gemini", "gemini-2.5-flash", "{}x");
    expect(err.model).toBe("gemini-2.5-flash");
  });

  it("sets the sample property", () => {
    const sample = "This is not valid JSON at all";
    const err = new ProviderJsonParseError("deepseek", "deepseek-chat", sample);
    expect(err.sample).toBe(sample);
  });

  it("sets a default message containing provider, model, and sample", () => {
    const err = new ProviderJsonParseError(
      "zai",
      "glm-4-plus",
      "broken output",
    );
    expect(err.message).toContain("zai");
    expect(err.message).toContain("glm-4-plus");
    expect(err.message).toContain("broken output");
  });

  it("uses a custom message when provided", () => {
    const err = new ProviderJsonParseError(
      "moonshot",
      "kimi-k2.5",
      "raw text",
      "custom parse error",
    );
    expect(err.message).toBe("custom parse error");
    expect(err.provider).toBe("moonshot");
    expect(err.model).toBe("kimi-k2.5");
    expect(err.sample).toBe("raw text");
  });

  it("has name set to ProviderJsonParseError", () => {
    const err = new ProviderJsonParseError("mock", "mock-model", "sample");
    expect(err.name).toBe("ProviderJsonParseError");
  });

  it("truncates long samples in the default message", () => {
    const longSample = "x".repeat(500);
    const err = new ProviderJsonParseError("openai", "gpt-5", longSample);
    // The default message slices sample to 200 chars
    expect(err.message.length).toBeLessThan(longSample.length + 100);
    // But the full sample is preserved on the property
    expect(err.sample).toBe(longSample);
    expect(err.sample.length).toBe(500);
  });
});
