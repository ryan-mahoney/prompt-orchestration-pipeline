import { describe, expect, it } from "vitest";
import {
  ProviderJsonModeError,
  ProviderJsonParseError,
  type ChatOptions,
  type OpenCodeOptions,
  type OpenCodePermissionAction,
  type OpenCodePermissionConfig,
  type OpenCodePermissionKey,
  type OpenCodePermissionName,
  type OpenCodePermissionRule,
  type OpenCodeRequestConfig,
} from "../types.ts";

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

describe("OpenCode types", () => {
  it("constructs ChatOptions with provider opencode and nested config", () => {
    const options: ChatOptions = {
      provider: "opencode",
      messages: [{ role: "user", content: "hello" }],
      opencode: {
        mode: "sdk",
        baseUrl: "http://localhost:3000",
        permission: { "*": "deny" },
      },
    };
    expect(options.provider).toBe("opencode");
    expect(options.opencode?.mode).toBe("sdk");
    expect(options.opencode?.baseUrl).toBe("http://localhost:3000");
    expect(options.opencode?.permission).toEqual({ "*": "deny" });
  });

  it("constructs OpenCodeOptions extending ProviderOptions", () => {
    const options: OpenCodeOptions = {
      messages: [{ role: "user", content: "test" }],
      model: "default",
      opencode: {
        mode: "cli",
        permission: "deny",
        structuredOutputRetryCount: 3,
      },
    };
    expect(options.opencode?.mode).toBe("cli");
    expect(options.opencode?.permission).toBe("deny");
    expect(options.opencode?.structuredOutputRetryCount).toBe(3);
  });

  it("accepts permission rule arrays", () => {
    const rules: OpenCodePermissionConfig = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "read", pattern: "/tmp/*", action: "allow" },
    ];
    expect(rules).toHaveLength(2);
  });

  it("accepts all OpenCodePermissionAction values", () => {
    const actions: OpenCodePermissionAction[] = ["allow", "ask", "deny"];
    expect(actions).toEqual(["allow", "ask", "deny"]);
  });

  it("accepts all OpenCodePermissionKey values", () => {
    const keys: OpenCodePermissionKey[] = [
      "read",
      "edit",
      "glob",
      "grep",
      "list",
      "bash",
      "task",
      "external_directory",
      "todowrite",
      "webfetch",
      "websearch",
      "lsp",
      "skill",
      "question",
      "doom_loop",
    ];
    expect(keys).toHaveLength(15);
  });
});
