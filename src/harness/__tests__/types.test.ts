import { describe, it, expect } from "vitest";
import type {
  HarnessName,
  McpServerConnection,
  HarnessUsage,
  HarnessEvent,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessDescriptor,
  AgentEntryConfig,
  AgentStepResult,
} from "../types.ts";

describe("HarnessName", () => {
  it("accepts all three valid harness names", () => {
    const names: HarnessName[] = ["claude", "codex", "opencode"];
    expect(names).toHaveLength(3);
  });
});

describe("McpServerConnection", () => {
  it("constructs with url and token", () => {
    const conn: McpServerConnection = {
      url: "http://127.0.0.1:9000/mcp",
      token: "ephemeral-secret",
    };
    expect(conn.url).toBe("http://127.0.0.1:9000/mcp");
    expect(conn.token).toBe("ephemeral-secret");
  });
});

describe("HarnessUsage", () => {
  it("constructs with all token counts", () => {
    const usage: HarnessUsage = {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    };
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(200);
    expect(usage.totalTokens).toBe(300);
  });
});

describe("HarnessEvent", () => {
  it("constructs a text event", () => {
    const event: HarnessEvent = { type: "text", raw: {}, text: "hello" };
    expect(event.type).toBe("text");
    expect(event.text).toBe("hello");
  });

  it("constructs a tool_call event", () => {
    const event: HarnessEvent = {
      type: "tool_call",
      raw: {},
      tool: "read_file",
    };
    expect(event.type).toBe("tool_call");
    expect(event.tool).toBe("read_file");
  });

  it("constructs a tool_result event", () => {
    const event: HarnessEvent = { type: "tool_result", raw: {} };
    expect(event.type).toBe("tool_result");
  });

  it("constructs a system event", () => {
    const event: HarnessEvent = { type: "system", raw: {} };
    expect(event.type).toBe("system");
  });

  it("constructs a result event", () => {
    const event: HarnessEvent = { type: "result", raw: {} };
    expect(event.type).toBe("result");
  });

  it("constructs a raw event", () => {
    const event: HarnessEvent = { type: "raw", raw: { data: 1 } };
    expect(event.type).toBe("raw");
    expect(event.raw).toEqual({ data: 1 });
  });
});

describe("HarnessRunOptions", () => {
  it("constructs with required fields only", () => {
    const opts: HarnessRunOptions = {
      harness: "claude",
      prompt: "do something",
      cwd: "/tmp/work",
    };
    expect(opts.harness).toBe("claude");
    expect(opts.prompt).toBe("do something");
    expect(opts.cwd).toBe("/tmp/work");
    expect(opts.model).toBeUndefined();
    expect(opts.mcp).toBeUndefined();
    expect(opts.timeoutMs).toBeUndefined();
    expect(opts.signal).toBeUndefined();
    expect(opts.onEvent).toBeUndefined();
  });

  it("constructs with all optional fields", () => {
    const controller = new AbortController();
    const opts: HarnessRunOptions = {
      harness: "opencode",
      prompt: "test",
      cwd: "/tmp",
      model: "gpt-4",
      mcp: { url: "http://127.0.0.1:3000/mcp", token: "tok" },
      timeoutMs: 30_000,
      signal: controller.signal,
      onEvent: (e) => {
        void e;
      },
    };
    expect(opts.harness).toBe("opencode");
    expect(opts.model).toBe("gpt-4");
    expect(opts.mcp?.url).toBe("http://127.0.0.1:3000/mcp");
    expect(opts.timeoutMs).toBe(30_000);
    expect(opts.signal).toBe(controller.signal);
    expect(typeof opts.onEvent).toBe("function");
  });
});

describe("HarnessRunResult", () => {
  it("constructs with required fields only", () => {
    const result: HarnessRunResult = {
      finalMessage: "done",
      events: [],
      exitCode: 0,
    };
    expect(result.finalMessage).toBe("done");
    expect(result.events).toHaveLength(0);
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it("constructs with all optional fields", () => {
    const result: HarnessRunResult = {
      finalMessage: "completed",
      sessionId: "sess-123",
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      costUsd: 0.005,
      events: [{ type: "text", raw: {}, text: "hi" }],
      exitCode: 0,
    };
    expect(result.sessionId).toBe("sess-123");
    expect(result.usage?.totalTokens).toBe(150);
    expect(result.costUsd).toBe(0.005);
    expect(result.events).toHaveLength(1);
  });
});

describe("HarnessDescriptor", () => {
  it("constructs a minimal descriptor with correct method signatures", () => {
    const descriptor: HarnessDescriptor = {
      name: "claude",
      versionArgv: ["claude", "--version"],
      buildArgv: (o) => ["claude", "-p", o.prompt],
      buildEnv: () => ({ env: {} }),
      parseEvents: (lines) =>
        lines.map((raw) => ({ type: "raw" as const, raw })),
      extractFinalMessage: (events) =>
        events.find((e) => e.type === "text")?.text ?? "",
      extractUsage: () => undefined,
      extractCostUsd: () => undefined,
      extractSessionId: () => undefined,
    };
    expect(descriptor.name).toBe("claude");
    expect(descriptor.versionArgv).toEqual(["claude", "--version"]);
    expect(descriptor.buildArgv({ harness: "claude", prompt: "hi", cwd: "/tmp" })).toEqual([
      "claude", "-p", "hi",
    ]);
    expect(descriptor.buildEnv({ harness: "claude", prompt: "hi", cwd: "/tmp" })).toEqual({
      env: {},
    });
    expect(descriptor.parseEvents([{ foo: 1 }])).toEqual([
      { type: "raw", raw: { foo: 1 } },
    ]);
    expect(descriptor.extractFinalMessage([])).toBe("");
    expect(descriptor.extractUsage([])).toBeUndefined();
    expect(descriptor.extractCostUsd([])).toBeUndefined();
    expect(descriptor.extractSessionId([])).toBeUndefined();
  });

  it("supports tmpFiles in buildEnv", () => {
    const descriptor: HarnessDescriptor = {
      name: "opencode",
      versionArgv: ["opencode", "--version"],
      buildArgv: () => [],
      buildEnv: () => ({
        env: { OPENCODE_PERMISSION: "allow" },
        tmpFiles: [{ path: "/tmp/config.json", content: "{}" }],
      }),
      parseEvents: () => [],
      extractFinalMessage: () => "",
      extractUsage: () => undefined,
      extractCostUsd: () => undefined,
      extractSessionId: () => undefined,
    };
    const envResult = descriptor.buildEnv({
      harness: "opencode",
      prompt: "",
      cwd: "/tmp",
    });
    expect(envResult.env.OPENCODE_PERMISSION).toBe("allow");
    expect(envResult.tmpFiles).toHaveLength(1);
    expect(envResult.tmpFiles?.[0]?.path).toBe("/tmp/config.json");
  });
});

describe("AgentEntryConfig", () => {
  it("constructs with required fields only", () => {
    const config: AgentEntryConfig = { harness: "codex" };
    expect(config.harness).toBe("codex");
    expect(config.model).toBeUndefined();
    expect(config.prompt).toBeUndefined();
    expect(config.promptFrom).toBeUndefined();
    expect(config.cwd).toBeUndefined();
    expect(config.io).toBeUndefined();
    expect(config.timeoutMs).toBeUndefined();
    expect(config.captureDiff).toBeUndefined();
  });

  it("constructs with all optional fields", () => {
    const config: AgentEntryConfig = {
      harness: "claude",
      model: "sonnet",
      prompt: "do it",
      cwd: "/work",
      io: true,
      timeoutMs: 60_000,
      captureDiff: true,
    };
    expect(config.harness).toBe("claude");
    expect(config.model).toBe("sonnet");
    expect(config.prompt).toBe("do it");
    expect(config.cwd).toBe("/work");
    expect(config.io).toBe(true);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.captureDiff).toBe(true);
  });

  it("supports promptFrom instead of prompt", () => {
    const config: AgentEntryConfig = {
      harness: "opencode",
      promptFrom: "my-prompt-artifact",
    };
    expect(config.prompt).toBeUndefined();
    expect(config.promptFrom).toBe("my-prompt-artifact");
  });
});

describe("AgentStepResult", () => {
  it("constructs a success result", () => {
    const result: AgentStepResult = {
      ok: true,
      finalMessage: "all done",
      artifactsWritten: ["output.md"],
    };
    expect(result.ok).toBe(true);
    expect(result.finalMessage).toBe("all done");
    expect(result.artifactsWritten).toEqual(["output.md"]);
    expect(result.usage).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("constructs a failure result", () => {
    const result: AgentStepResult = {
      ok: false,
      finalMessage: "",
      artifactsWritten: [],
      error: "harness crashed",
    };
    expect(result.ok).toBe(false);
    expect(result.finalMessage).toBe("");
    expect(result.error).toBe("harness crashed");
  });

  it("constructs a result with all optional fields", () => {
    const result: AgentStepResult = {
      ok: true,
      finalMessage: "done",
      artifactsWritten: ["a.md", "b.patch"],
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      costUsd: 0.01,
      sessionId: "sess-456",
    };
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.costUsd).toBe(0.01);
    expect(result.sessionId).toBe("sess-456");
    expect(result.artifactsWritten).toHaveLength(2);
  });
});
