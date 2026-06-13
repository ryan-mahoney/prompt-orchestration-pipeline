import type { HarnessDescriptor } from "../types.ts";

export const codexDescriptor: HarnessDescriptor = {
  name: "codex",
  versionArgv: ["codex", "--version"],

  buildArgv(o) {
    return [
      "codex",
      "exec",
      o.prompt,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      o.cwd,
      ...(o.model ? ["-m", o.model] : []),
      ...(o.mcp
        ? [
            "-c",
            `mcp_servers.popio.url="${o.mcp.url}"`,
            "-c",
            'mcp_servers.popio.bearer_token_env_var="POP_MCP_TOKEN"',
          ]
        : []),
    ];
  },

  buildEnv(o) {
    const env: Record<string, string> = {};
    if (o.mcp) {
      env.POP_MCP_TOKEN = o.mcp.token;
    }
    return { env };
  },

  parseEvents(lines) {
    return lines.map((raw) => {
      const obj = raw as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : undefined;
      switch (type) {
        case "text":
          return { type: "text" as const, raw, text: String(obj.text ?? "") };
        case "tool_call":
          return {
            type: "tool_call" as const,
            raw,
            tool: typeof obj.tool === "string" ? obj.tool : undefined,
          };
        case "tool_result":
          return { type: "tool_result" as const, raw };
        case "system":
          return { type: "system" as const, raw };
        case "result":
          return { type: "result" as const, raw };
        default:
          return { type: "raw" as const, raw };
      }
    });
  },

  extractFinalMessage(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "text" || e.type === "result") {
        if (e.text) return e.text;
      }
    }
    return "";
  },

  extractUsage(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "result") {
        const raw = e.raw as Record<string, unknown>;
        const usage = raw.usage as Record<string, unknown> | undefined;
        if (usage && typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") {
          return {
            inputTokens: usage.input_tokens as number,
            outputTokens: usage.output_tokens as number,
            totalTokens: (usage.input_tokens as number) + (usage.output_tokens as number),
          };
        }
      }
    }
    return undefined;
  },

  extractCostUsd(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "result") {
        const raw = e.raw as Record<string, unknown>;
        if (typeof raw.total_cost_usd === "number") {
          return raw.total_cost_usd as number;
        }
      }
    }
    return undefined;
  },

  extractSessionId(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "result") {
        const raw = e.raw as Record<string, unknown>;
        if (typeof raw.session_id === "string") {
          return raw.session_id as string;
        }
      }
    }
    return undefined;
  },
};
