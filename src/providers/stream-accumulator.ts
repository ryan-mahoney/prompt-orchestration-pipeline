// ── src/providers/stream-accumulator.ts ──
// Shared streaming helpers: SSE framing, provider-specific delta parsers,
// idle-timeout control, and stream accumulation.

import type { AdapterUsage } from "./types.ts";

// ─── Shared types ────────────────────────────────────────────────────────────

/** A single parsed SSE frame with optional event type and data payload. */
export interface SSEFrame {
  event: string;
  data: string;
}

/** A delta yielded by any stream parser. */
export interface StreamDelta {
  deltaText: string;
  usage?: AdapterUsage;
  done: boolean;
}

// ─── Step 1: SSE line framing + IdleTimeoutController ────────────────────────

/**
 * Decodes a binary stream into parsed SSE frames.
 * Handles partial-line buffering, ignores comment lines (`:` prefix),
 * and emits a frame on each blank-line delimiter.
 */
export async function* frameSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith(":")) continue; // comment line

        if (line === "") {
          // Blank line = frame delimiter
          if (currentData) {
            yield { event: currentEvent, data: currentData };
          }
          currentEvent = "";
          currentData = "";
          continue;
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const value = line.slice(5).trimStart();
          currentData = currentData ? `${currentData}\n${value}` : value;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Process any remaining content in the buffer (no trailing newline)
  if (buffer) {
    const line = buffer;
    if (!line.startsWith(":")) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const value = line.slice(5).trimStart();
        currentData = currentData ? `${currentData}\n${value}` : value;
      }
    }
  }

  // Flush any remaining buffered frame
  if (currentData) {
    yield { event: currentEvent, data: currentData };
  }
}

/**
 * Wraps an AbortController with an idle timer that aborts after
 * `timeoutMs` of inactivity. Call `reset()` on each received chunk.
 */
export class IdleTimeoutController {
  private controller: AbortController;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.controller = new AbortController();
    this.startTimer();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  reset(): void {
    this.clearTimer();
    if (!this.controller.signal.aborted) {
      this.startTimer();
    }
  }

  private startTimer(): void {
    this.timer = setTimeout(() => {
      this.controller.abort(new Error("Idle timeout exceeded"));
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ─── Step 2: OpenAI-compatible SSE delta parser ──────────────────────────────

/**
 * Parses an SSE frame iterator (from `frameSse`) for OpenAI-compatible
 * streaming responses. Extracts `choices[0].delta.content` and terminal
 * `usage`. Terminates on the `[DONE]` sentinel.
 *
 * Used by DeepSeek, Moonshot, Alibaba, and Zhipu adapters.
 */
export async function* parseOpenAiSse(
  frames: AsyncIterable<SSEFrame>,
): AsyncGenerator<StreamDelta> {
  for await (const frame of frames) {
    if (frame.data === "[DONE]") {
      yield { deltaText: "", done: true };
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue; // skip malformed lines
    }

    const choices = parsed.choices as
      | Array<{ delta?: { content?: string }; finish_reason?: string }>
      | undefined;

    const deltaText = choices?.[0]?.delta?.content ?? "";
    const usage = parseOpenAiUsage(parsed.usage);
    const done = choices?.[0]?.finish_reason != null && choices[0].finish_reason !== "";

    yield { deltaText, usage, done };
  }
}

function parseOpenAiUsage(raw: unknown): AdapterUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  if (
    typeof u.prompt_tokens === "number" &&
    typeof u.completion_tokens === "number"
  ) {
    return {
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      total_tokens:
        typeof u.total_tokens === "number"
          ? u.total_tokens
          : u.prompt_tokens + u.completion_tokens,
    };
  }
  return undefined;
}

// ─── Step 3: Anthropic event parser ──────────────────────────────────────────

/**
 * Parses Anthropic's SSE stream. Discriminates on the `event:` field:
 * - `content_block_delta` → extracts `delta.text`
 * - `message_delta` → extracts `usage.output_tokens`
 * - `message_start` → extracts input usage from `message.usage`
 * - `message_stop` → signals done
 * - `ping` and unknown events are ignored.
 */
export async function* parseAnthropicSse(
  frames: AsyncIterable<SSEFrame>,
): AsyncGenerator<StreamDelta> {
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const frame of frames) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue;
    }

    switch (frame.event) {
      case "message_start": {
        const msg = parsed.message as Record<string, unknown> | undefined;
        const u = msg?.usage as Record<string, unknown> | undefined;
        if (typeof u?.input_tokens === "number") {
          inputTokens = u.input_tokens as number;
        }
        break;
      }

      case "content_block_delta": {
        const delta = parsed.delta as { text?: string } | undefined;
        yield { deltaText: delta?.text ?? "", done: false };
        break;
      }

      case "message_delta": {
        const u = parsed.usage as Record<string, unknown> | undefined;
        if (typeof u?.output_tokens === "number") {
          outputTokens = u.output_tokens as number;
        }
        break;
      }

      case "message_stop": {
        const usage: AdapterUsage = {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        };
        yield { deltaText: "", usage, done: true };
        return;
      }

      default:
        // ping, content_block_start, content_block_stop, etc. — ignore
        break;
    }
  }
}

// ─── Step 4: Gemini stream parser ────────────────────────────────────────────

/**
 * Parses Gemini's SSE-wrapped streaming response (`alt=sse`).
 * Extracts text from `candidates[0].content.parts[].text` and captures
 * `usageMetadata` from the final payload.
 */
export async function* parseGeminiSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamDelta> {
  let lastUsage: AdapterUsage | undefined;

  for await (const frame of frameSse(stream)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue;
    }

    const candidates = parsed.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined;

    let text = "";
    const parts = candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.text) text += part.text;
      }
    }

    // Capture usage from usageMetadata (present on final chunk)
    const meta = parsed.usageMetadata as Record<string, unknown> | undefined;
    if (meta) {
      const prompt = (meta.promptTokenCount as number) ?? 0;
      const completion = (meta.candidatesTokenCount as number) ?? 0;
      lastUsage = {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens:
          (meta.totalTokenCount as number) ?? prompt + completion,
      };
    }

    // Gemini signals completion when candidates have a finishReason
    const finishReason = (
      parsed.candidates as Array<{ finishReason?: string }> | undefined
    )?.[0]?.finishReason;
    const done = finishReason != null && finishReason !== "";

    yield {
      deltaText: text,
      usage: done ? lastUsage : undefined,
      done,
    };
  }
}

// ─── Step 5: Claude Code stream-json parser ──────────────────────────────────

/**
 * Parses Claude Code's line-delimited JSON stream (not SSE).
 * Events have a `type` field. `assistant` events carry text content,
 * `result` events signal completion.
 */
export async function* parseClaudeCodeStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamDelta> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (parsed.type === "assistant") {
          const content = extractClaudeCodeText(parsed);
          yield { deltaText: content, done: false };
        } else if (parsed.type === "result") {
          yield { deltaText: "", done: true };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractClaudeCodeText(event: Record<string, unknown>): string {
  // Claude Code assistant events may nest text in content blocks
  const content = event.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          (block as Record<string, unknown>).type === "text",
      )
      .map((block: unknown) => String((block as Record<string, string>).text ?? ""))
      .join("");
  }
  // Delta-style: { delta: { text: "..." } }
  const delta = event.delta as { text?: string } | undefined;
  if (delta?.text) return delta.text;
  return "";
}

// ─── Step 6: accumulateStream() ──────────────────────────────────────────────

/** Accumulated result from a completed stream. */
export interface AccumulatedStream {
  text: string;
  usage: AdapterUsage | undefined;
}

/**
 * Consumes an async iterable of stream deltas, concatenates text, and
 * returns the final accumulated text and usage. Resets the idle-timeout
 * controller on each received chunk.
 */
export async function accumulateStream(
  deltas: AsyncIterable<StreamDelta>,
  idle: IdleTimeoutController,
): Promise<AccumulatedStream> {
  let text = "";
  let usage: AdapterUsage | undefined;

  for await (const delta of deltas) {
    idle.reset();
    text += delta.deltaText;
    if (delta.usage) usage = delta.usage;
    if (delta.done) break;
  }

  return { text, usage };
}
