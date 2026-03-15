// ── src/providers/claude-code.ts ──
// Claude Code CLI adapter using Bun subprocess APIs.

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  ensureJsonResponseFormat,
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
} from "./base.ts";
import {
  IdleTimeoutController,
  parseClaudeCodeStream,
  accumulateStream,
} from "./stream-accumulator.ts";
import { ProviderJsonParseError } from "./types.ts";
import type { ClaudeCodeOptions, AdapterResponse } from "./types.ts";

const DEFAULT_MODEL = "sonnet";
const DEFAULT_MAX_TURNS = 1;
const DEFAULT_RESPONSE_FORMAT = "json";
const DEFAULT_MAX_RETRIES = 3;
const AVAILABILITY_TIMEOUT_MS = 5_000;

const ZERO_USAGE = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
} as const;

export async function claudeCodeChat(
  options: ClaudeCodeOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model = DEFAULT_MODEL,
    maxTokens,
    maxTurns = DEFAULT_MAX_TURNS,
    responseFormat = DEFAULT_RESPONSE_FORMAT,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  ensureJsonResponseFormat(responseFormat, "claudecode");

  const { systemMsg, userMsg } = extractMessages(messages);

  // Build the prompt: prepend system message if present
  const prompt = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg;

  const args = [
    "claude",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--max-turns",
    String(maxTurns),
  ];
  if (maxTokens != null) {
    args.push("--max-tokens", String(maxTokens));
  }
  args.push("-p", prompt);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const idle = new IdleTimeoutController(DEFAULT_REQUEST_TIMEOUT_MS);

      // Kill the subprocess if the idle timeout fires
      const onAbort = () => proc.kill();
      idle.signal.addEventListener("abort", onAbort, { once: true });

      const deltas = parseClaudeCodeStream(proc.stdout as ReadableStream<Uint8Array>);
      const accumulated = await accumulateStream(deltas, idle);

      idle.signal.removeEventListener("abort", onAbort);
      await proc.exited;

      if (proc.exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(
          `Claude Code CLI exited with code ${proc.exitCode}: ${stderr || accumulated.text}`,
        );
      }

      const cleanedText = stripMarkdownFences(accumulated.text);
      const parsed = tryParseJSON(cleanedText);

      if (typeof parsed === "string") {
        throw new ProviderJsonParseError(
          "claudecode",
          model,
          parsed.slice(0, 200),
        );
      }

      return {
        content: parsed as Record<string, unknown>,
        text: accumulated.text,
        usage: { ...ZERO_USAGE },
        raw: accumulated.text,
      };
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}

export function isClaudeCodeAvailable(): boolean {
  try {
    const result = Bun.spawnSync(["claude", "--version"], {
      timeout: AVAILABILITY_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
