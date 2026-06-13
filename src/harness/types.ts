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

/** Raw result of running a harness CLI's auth-status command, fed to {@link HarnessDescriptor.interpretAuthStatus}. */
export interface AuthStatusResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HarnessDescriptor {
  name: HarnessName;
  versionArgv: readonly string[];
  /** The CLI command used to launch this harness. Defaults to {@link name} when omitted. */
  binName?: string;
  /** Extra install dirs (beyond PATH) to search for the CLI — e.g. ["~/.opencode/bin"]. */
  binDirs?: readonly string[];
  /** Args (after the binary) for the CLI's own auth-status check, e.g. ["auth", "status"]. */
  authStatusArgv?: readonly string[];
  /** Pure interpreter mapping the auth-status command result to true/false/null (null = can't tell). */
  interpretAuthStatus?(result: AuthStatusResult): boolean | null;
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

/** Startup discovery result for one harness CLI. */
export interface HarnessProbe {
  name: HarnessName;
  /** Absolute path to the resolved CLI, or null when it could not be found. */
  binPath: string | null;
  available: boolean;
  /** true/false from the CLI's own auth check; null when unavailable or undeterminable. Advisory only. */
  authenticated: boolean | null;
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
