import { describe, it, expect } from "vitest";
import { claudeDescriptor } from "../descriptors/claude.ts";
import { codexDescriptor } from "../descriptors/codex.ts";
import { opencodeDescriptor } from "../descriptors/opencode.ts";
import { DESCRIPTORS } from "../descriptors/index.ts";
import type { HarnessEvent, HarnessRunOptions } from "../types.ts";

const baseOpts: HarnessRunOptions = {
  harness: "claude",
  prompt: "do the thing",
  cwd: "/tmp/work",
};

const mcpConn = { url: "http://127.0.0.1:9000/mcp", token: "tok-123" };

// ── index.ts ──────────────────────────────────────────────────────────

describe("DESCRIPTORS", () => {
  it("contains all three harness names", () => {
    expect(Object.keys(DESCRIPTORS).sort()).toEqual(["claude", "codex", "opencode"]);
  });

  it("maps each name to the correct descriptor", () => {
    expect(DESCRIPTORS.claude.name).toBe("claude");
    expect(DESCRIPTORS.codex.name).toBe("codex");
    expect(DESCRIPTORS.opencode.name).toBe("opencode");
  });
});

// ── versionArgv ───────────────────────────────────────────────────────

describe("versionArgv", () => {
  it("claude uses --version", () => {
    expect(claudeDescriptor.versionArgv).toEqual(["claude", "--version"]);
  });

  it("codex uses --version", () => {
    expect(codexDescriptor.versionArgv).toEqual(["codex", "--version"]);
  });

  it("opencode uses --version", () => {
    expect(opencodeDescriptor.versionArgv).toEqual(["opencode", "--version"]);
  });
});

// ── claude descriptor ─────────────────────────────────────────────────

describe("claude buildArgv", () => {
  it("includes --dangerously-skip-permissions", () => {
    const argv = claudeDescriptor.buildArgv(baseOpts);
    expect(argv).toContain("--dangerously-skip-permissions");
  });

  it("includes --model when model is given", () => {
    const argv = claudeDescriptor.buildArgv({ ...baseOpts, model: "sonnet" });
    expect(argv).toContain("--model");
    expect(argv).toContain("sonnet");
  });

  it("omits --model when model is absent", () => {
    const argv = claudeDescriptor.buildArgv(baseOpts);
    expect(argv).not.toContain("--model");
  });

  it("includes -p with the prompt", () => {
    const argv = claudeDescriptor.buildArgv(baseOpts);
    expect(argv[0]).toBe("claude");
    expect(argv[1]).toBe("-p");
    expect(argv[2]).toBe("do the thing");
  });

  it("includes --output-format stream-json and --verbose", () => {
    const argv = claudeDescriptor.buildArgv(baseOpts);
    expect(argv).toContain("--output-format");
    expect(argv).toContain("stream-json");
    expect(argv).toContain("--verbose");
  });

  it("includes --mcp-config with correct JSON when mcp is set", () => {
    const argv = claudeDescriptor.buildArgv({ ...baseOpts, mcp: mcpConn });
    const idx = argv.indexOf("--mcp-config");
    expect(idx).toBeGreaterThan(-1);
    const config = JSON.parse(argv[idx + 1]!);
    expect(config.mcpServers.popio.type).toBe("http");
    expect(config.mcpServers.popio.url).toBe("http://127.0.0.1:9000/mcp");
    expect(config.mcpServers.popio.headers.Authorization).toBe("Bearer tok-123");
  });

  it("omits --mcp-config when mcp is absent", () => {
    const argv = claudeDescriptor.buildArgv(baseOpts);
    expect(argv).not.toContain("--mcp-config");
  });
});

describe("claude buildEnv", () => {
  it("returns empty env", () => {
    const result = claudeDescriptor.buildEnv(baseOpts);
    expect(result.env).toEqual({});
    expect(result.tmpFiles).toBeUndefined();
  });
});

// ── codex descriptor ──────────────────────────────────────────────────

describe("codex buildArgv", () => {
  it("includes --dangerously-bypass-approvals-and-sandbox", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex" });
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("includes --skip-git-repo-check", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex" });
    expect(argv).toContain("--skip-git-repo-check");
  });

  it("includes -C with cwd", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex" });
    const idx = argv.indexOf("-C");
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe("/tmp/work");
  });

  it("includes -m when model is given", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex", model: "gpt-4" });
    expect(argv).toContain("-m");
    expect(argv).toContain("gpt-4");
  });

  it("omits -m when model is absent", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex" });
    expect(argv).not.toContain("-m");
  });

  it("includes MCP -c overrides when mcp is set", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex", mcp: mcpConn });
    const urlArg = argv.find((a) => a.includes("mcp_servers.popio.url"));
    expect(urlArg).toBe('mcp_servers.popio.url="http://127.0.0.1:9000/mcp"');
    const tokenArg = argv.find((a) => a.includes("bearer_token_env_var"));
    expect(tokenArg).toBe('mcp_servers.popio.bearer_token_env_var="POP_MCP_TOKEN"');
  });

  it("omits MCP -c overrides when mcp is absent", () => {
    const argv = codexDescriptor.buildArgv({ ...baseOpts, harness: "codex" });
    expect(argv.find((a) => a.includes("mcp_servers"))).toBeUndefined();
  });
});

describe("codex buildEnv", () => {
  it("sets POP_MCP_TOKEN when mcp is set", () => {
    const result = codexDescriptor.buildEnv({ ...baseOpts, harness: "codex", mcp: mcpConn });
    expect(result.env.POP_MCP_TOKEN).toBe("tok-123");
  });

  it("does not set POP_MCP_TOKEN when mcp is absent", () => {
    const result = codexDescriptor.buildEnv({ ...baseOpts, harness: "codex" });
    expect(result.env.POP_MCP_TOKEN).toBeUndefined();
  });

  it("does not set CODEX_HOME", () => {
    const result = codexDescriptor.buildEnv({ ...baseOpts, harness: "codex", mcp: mcpConn });
    expect(result.env.CODEX_HOME).toBeUndefined();
  });
});

// ── opencode descriptor ───────────────────────────────────────────────

describe("opencode buildArgv", () => {
  it("includes --dangerously-skip-permissions", () => {
    const argv = opencodeDescriptor.buildArgv({ ...baseOpts, harness: "opencode" });
    expect(argv).toContain("--dangerously-skip-permissions");
  });

  it("includes --dir with cwd", () => {
    const argv = opencodeDescriptor.buildArgv({ ...baseOpts, harness: "opencode" });
    const idx = argv.indexOf("--dir");
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe("/tmp/work");
  });

  it("includes --model when model is given", () => {
    const argv = opencodeDescriptor.buildArgv({ ...baseOpts, harness: "opencode", model: "gpt-4o" });
    expect(argv).toContain("--model");
    expect(argv).toContain("gpt-4o");
  });

  it("omits --model when model is absent", () => {
    const argv = opencodeDescriptor.buildArgv({ ...baseOpts, harness: "opencode" });
    expect(argv).not.toContain("--model");
  });

  it("includes --format json", () => {
    const argv = opencodeDescriptor.buildArgv({ ...baseOpts, harness: "opencode" });
    expect(argv).toContain("--format");
    expect(argv).toContain("json");
  });
});

describe("opencode buildEnv", () => {
  it("sets OPENCODE_PERMISSION allow-all", () => {
    const result = opencodeDescriptor.buildEnv({ ...baseOpts, harness: "opencode" });
    const perm = JSON.parse(result.env.OPENCODE_PERMISSION!);
    expect(perm).toEqual([{ permission: "*", pattern: "*", action: "allow" }]);
  });

  it("writes opencode.json to tmpFiles when mcp is set", () => {
    const result = opencodeDescriptor.buildEnv({ ...baseOpts, harness: "opencode", mcp: mcpConn });
    expect(result.tmpFiles).toHaveLength(1);
    const file = result.tmpFiles![0]!;
    expect(file.path).toContain("opencode-mcp-");
    expect(file.path).toContain("opencode.json");
    const config = JSON.parse(file.content);
    expect(config.mcp.popio.type).toBe("remote");
    expect(config.mcp.popio.url).toBe("http://127.0.0.1:9000/mcp");
    expect(config.mcp.popio.headers.Authorization).toBe("Bearer tok-123");
    expect(config.mcp.popio.enabled).toBe(true);
  });

  it("sets OPENCODE_CONFIG_DIR when mcp is set", () => {
    const result = opencodeDescriptor.buildEnv({ ...baseOpts, harness: "opencode", mcp: mcpConn });
    expect(result.env.OPENCODE_CONFIG_DIR).toContain("opencode-mcp-");
  });

  it("omits tmpFiles when mcp is absent", () => {
    const result = opencodeDescriptor.buildEnv({ ...baseOpts, harness: "opencode" });
    expect(result.tmpFiles).toBeUndefined();
  });

  it("does not set OPENCODE_CONFIG_DIR when mcp is absent", () => {
    const result = opencodeDescriptor.buildEnv({ ...baseOpts, harness: "opencode" });
    expect(result.env.OPENCODE_CONFIG_DIR).toBeUndefined();
  });
});

// ── extractors ────────────────────────────────────────────────────────

describe("claude extractors", () => {
  const resultEvent: HarnessEvent = {
    type: "result",
    raw: {
      type: "result",
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.003,
      session_id: "sess-claude-1",
    },
  };
  const textEvent: HarnessEvent = { type: "text", raw: { type: "text" }, text: "hello" };
  const events: HarnessEvent[] = [textEvent, resultEvent];

  it("extractUsage returns token counts", () => {
    const usage = claudeDescriptor.extractUsage(events);
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  it("extractCostUsd returns cost", () => {
    expect(claudeDescriptor.extractCostUsd(events)).toBe(0.003);
  });

  it("extractSessionId returns session id", () => {
    expect(claudeDescriptor.extractSessionId(events)).toBe("sess-claude-1");
  });

  it("extractFinalMessage returns last text", () => {
    expect(claudeDescriptor.extractFinalMessage(events)).toBe("hello");
  });

  it("extractors return undefined when no result event", () => {
    expect(claudeDescriptor.extractUsage([textEvent])).toBeUndefined();
    expect(claudeDescriptor.extractCostUsd([textEvent])).toBeUndefined();
    expect(claudeDescriptor.extractSessionId([textEvent])).toBeUndefined();
  });

  it("extractFinalMessage returns empty string when no text/result events", () => {
    expect(claudeDescriptor.extractFinalMessage([])).toBe("");
  });
});

describe("codex extractors", () => {
  const resultEvent: HarnessEvent = {
    type: "result",
    raw: {
      type: "result",
      usage: { input_tokens: 200, output_tokens: 80 },
      total_cost_usd: 0.007,
      session_id: "sess-codex-1",
    },
  };
  const events: HarnessEvent[] = [resultEvent];

  it("extractUsage returns token counts", () => {
    const usage = codexDescriptor.extractUsage(events);
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 80, totalTokens: 280 });
  });

  it("extractCostUsd returns cost", () => {
    expect(codexDescriptor.extractCostUsd(events)).toBe(0.007);
  });

  it("extractSessionId returns session id", () => {
    expect(codexDescriptor.extractSessionId(events)).toBe("sess-codex-1");
  });

  it("extractors return undefined when no result event", () => {
    const rawEvent: HarnessEvent = { type: "raw", raw: { foo: 1 } };
    expect(codexDescriptor.extractUsage([rawEvent])).toBeUndefined();
    expect(codexDescriptor.extractCostUsd([rawEvent])).toBeUndefined();
    expect(codexDescriptor.extractSessionId([rawEvent])).toBeUndefined();
  });
});

describe("opencode extractors", () => {
  const resultEvent: HarnessEvent = {
    type: "result",
    raw: {
      type: "result",
      info: {
        tokens: { input: 300, output: 120, total: 420 },
        costUsd: 0.012,
        sessionId: "sess-oc-1",
      },
    },
  };
  const events: HarnessEvent[] = [resultEvent];

  it("extractUsage returns token counts from info.tokens", () => {
    const usage = opencodeDescriptor.extractUsage(events);
    expect(usage).toEqual({ inputTokens: 300, outputTokens: 120, totalTokens: 420 });
  });

  it("extractCostUsd returns cost from info.costUsd", () => {
    expect(opencodeDescriptor.extractCostUsd(events)).toBe(0.012);
  });

  it("extractSessionId returns session id from info.sessionId", () => {
    expect(opencodeDescriptor.extractSessionId(events)).toBe("sess-oc-1");
  });

  it("extractors return undefined when no result event", () => {
    const rawEvent: HarnessEvent = { type: "raw", raw: {} };
    expect(opencodeDescriptor.extractUsage([rawEvent])).toBeUndefined();
    expect(opencodeDescriptor.extractCostUsd([rawEvent])).toBeUndefined();
    expect(opencodeDescriptor.extractSessionId([rawEvent])).toBeUndefined();
  });
});

// ── parseEvents ───────────────────────────────────────────────────────

describe("parseEvents (shared across descriptors)", () => {
  it("categorizes known event types", () => {
    const lines = [
      { type: "text", text: "hi" },
      { type: "tool_call", tool: "read_file" },
      { type: "tool_result" },
      { type: "system" },
      { type: "result" },
    ];
    const events = claudeDescriptor.parseEvents(lines);
    expect(events.map((e) => e.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "system",
      "result",
    ]);
  });

  it("defaults unknown types to raw", () => {
    const lines = [{ type: "unknown_thing", data: 1 }, { no_type: true }];
    const events = claudeDescriptor.parseEvents(lines);
    expect(events[0]!.type).toBe("raw");
    expect(events[1]!.type).toBe("raw");
  });

  it("preserves raw reference", () => {
    const line = { type: "text", text: "hello" };
    const events = claudeDescriptor.parseEvents([line]);
    expect(events[0]!.raw).toBe(line);
  });
});
