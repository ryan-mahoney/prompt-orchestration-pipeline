export type HarnessName = "claude" | "codex" | "opencode";

export interface McpServerConnection {
  url: string;
  token: string;
}

export interface HarnessUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HarnessEvent {
  type: "text" | "tool_call" | "tool_result" | "system" | "result" | "raw";
  raw: unknown;
  text?: string;
  tool?: string;
}

export interface HarnessRunOptions {
  harness: HarnessName;
  prompt: string;
  cwd: string;
  model?: string;
  mcp?: McpServerConnection;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
}

export interface HarnessRunResult {
  finalMessage: string;
  sessionId?: string;
  usage?: HarnessUsage;
  costUsd?: number;
  events: HarnessEvent[];
  exitCode: number;
}

export interface HarnessDescriptor {
  name: HarnessName;
  versionArgv: readonly string[];
  buildArgv(o: HarnessRunOptions): string[];
  buildEnv(o: HarnessRunOptions): {
    env: Record<string, string>;
    tmpFiles?: { path: string; content: string }[];
  };
  parseEvents(lines: unknown[]): HarnessEvent[];
  extractFinalMessage(events: HarnessEvent[]): string;
  extractUsage(events: HarnessEvent[]): HarnessUsage | undefined;
  extractCostUsd(events: HarnessEvent[]): number | undefined;
  extractSessionId(events: HarnessEvent[]): string | undefined;
}

export interface AgentEntryConfig {
  harness: HarnessName;
  model?: string;
  prompt?: string;
  promptFrom?: string;
  cwd?: string;
  io?: boolean;
  timeoutMs?: number;
  captureDiff?: boolean;
}

export interface AgentStepResult {
  ok: boolean;
  finalMessage: string;
  artifactsWritten: string[];
  usage?: HarnessUsage;
  costUsd?: number;
  sessionId?: string;
  error?: string;
}
