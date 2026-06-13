import type { HarnessDescriptor } from "../types.ts";

const OPENCODE_PERMISSION = JSON.stringify([
  { permission: "*", pattern: "*", action: "allow" },
]);

export const opencodeDescriptor: HarnessDescriptor = {
  name: "opencode",
  versionArgv: ["opencode", "--version"],
  binName: "opencode",
  binDirs: ["~/.opencode/bin", "~/.local/bin"],
  authStatusArgv: ["auth", "list"],

  // `opencode auth list` prints "N credentials" for configured providers.
  interpretAuthStatus({ exitCode, stdout }) {
    if (exitCode !== 0) return null;
    const text = stdout.replace(/\x1b\[[0-9;]*m/g, "");
    const match = text.match(/(\d+)\s+credentials?/i);
    if (match) return Number(match[1]) > 0;
    return /credential/i.test(text) ? true : null;
  },

  buildArgv(o) {
    return [
      "opencode",
      "run",
      o.prompt,
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--dir",
      o.cwd,
      ...(o.model ? ["--model", o.model] : []),
    ];
  },

  buildEnv(o) {
    const env: Record<string, string> = {
      OPENCODE_PERMISSION,
    };
    const tmpFiles: { path: string; content: string }[] = [];

    if (o.mcp) {
      const configDir = `/tmp/opencode-mcp-${Date.now()}`;
      const configPath = `${configDir}/opencode.json`;
      const config = {
        mcp: {
          popio: {
            type: "remote",
            url: o.mcp.url,
            headers: { Authorization: `Bearer ${o.mcp.token}` },
            enabled: true,
          },
        },
      };
      tmpFiles.push({ path: configPath, content: JSON.stringify(config) });
      env.OPENCODE_CONFIG_DIR = configDir;
    }

    return { env, tmpFiles: tmpFiles.length > 0 ? tmpFiles : undefined };
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
        const info = raw.info as Record<string, unknown> | undefined;
        const tokens = info?.tokens as Record<string, unknown> | undefined;
        if (tokens && typeof tokens.input === "number" && typeof tokens.output === "number") {
          return {
            inputTokens: tokens.input as number,
            outputTokens: tokens.output as number,
            totalTokens: typeof tokens.total === "number" ? (tokens.total as number) : (tokens.input as number) + (tokens.output as number),
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
        const info = raw.info as Record<string, unknown> | undefined;
        if (info && typeof info.costUsd === "number") {
          return info.costUsd as number;
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
        const info = raw.info as Record<string, unknown> | undefined;
        if (info && typeof info.sessionId === "string") {
          return info.sessionId as string;
        }
      }
    }
    return undefined;
  },
};
