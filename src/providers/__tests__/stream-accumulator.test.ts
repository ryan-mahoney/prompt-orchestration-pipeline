import { describe, expect, it, vi } from "vitest";
import {
  frameSse,
  parseOpenAiSse,
  parseAnthropicSse,
  parseGeminiSse,
  parseClaudeCodeStream,
  IdleTimeoutController,
  accumulateStream,
} from "../stream-accumulator.ts";
import type { SSEFrame, StreamDelta } from "../stream-accumulator.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]!));
      else controller.close();
    },
  });
}

async function* framesToAsyncIterable(
  frames: SSEFrame[],
): AsyncIterable<SSEFrame> {
  for (const frame of frames) {
    yield frame;
  }
}

async function collectDeltas(
  gen: AsyncIterable<StreamDelta>,
): Promise<StreamDelta[]> {
  const results: StreamDelta[] = [];
  for await (const delta of gen) {
    results.push(delta);
  }
  return results;
}

// ─── frameSse ───────────────────────────────────────────────────────────────

describe("frameSse", () => {
  it("parses well-formed SSE frames with event and data fields", async () => {
    const stream = makeStream([
      "event: message\ndata: hello\n\n",
    ]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toEqual([{ event: "message", data: "hello" }]);
  });

  it("handles partial lines across chunks (data split mid-line)", async () => {
    const stream = makeStream([
      "event: msg\nda",
      "ta: partial\n\n",
    ]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toEqual([{ event: "msg", data: "partial" }]);
  });

  it("skips comment lines (starting with :)", async () => {
    const stream = makeStream([
      ": this is a comment\ndata: real\n\n",
    ]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toEqual([{ event: "", data: "real" }]);
  });

  it("handles blank-line delimiters correctly", async () => {
    const stream = makeStream([
      "data: first\n\ndata: second\n\n",
    ]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ event: "", data: "first" });
    expect(frames[1]).toEqual({ event: "", data: "second" });
  });

  it("yields multiple frames from a single chunk", async () => {
    const stream = makeStream([
      "event: a\ndata: one\n\nevent: b\ndata: two\n\nevent: c\ndata: three\n\n",
    ]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => f.data)).toEqual(["one", "two", "three"]);
  });

  it("flushes remaining buffered frame at stream end", async () => {
    // No trailing blank line — the frame should still be emitted on stream close
    const stream = makeStream(["data: unflushed"]);
    const frames: SSEFrame[] = [];
    for await (const frame of frameSse(stream)) {
      frames.push(frame);
    }
    expect(frames).toEqual([{ event: "", data: "unflushed" }]);
  });
});

// ─── parseOpenAiSse ─────────────────────────────────────────────────────────

describe("parseOpenAiSse", () => {
  it("extracts choices[0].delta.content from data lines", async () => {
    const frames = framesToAsyncIterable([
      { event: "", data: '{"choices":[{"delta":{"content":"Hello"}}]}' },
      { event: "", data: '{"choices":[{"delta":{"content":" world"}}]}' },
      { event: "", data: "[DONE]" },
    ]);
    const deltas = await collectDeltas(parseOpenAiSse(frames));
    expect(deltas[0]!.deltaText).toBe("Hello");
    expect(deltas[1]!.deltaText).toBe(" world");
  });

  it("terminates on [DONE] sentinel", async () => {
    const frames = framesToAsyncIterable([
      { event: "", data: '{"choices":[{"delta":{"content":"x"}}]}' },
      { event: "", data: "[DONE]" },
      { event: "", data: '{"choices":[{"delta":{"content":"after"}}]}' },
    ]);
    const deltas = await collectDeltas(parseOpenAiSse(frames));
    // The last frame after [DONE] should not be yielded
    expect(deltas).toHaveLength(2);
    expect(deltas[1]!.done).toBe(true);
    expect(deltas[1]!.deltaText).toBe("");
  });

  it("skips malformed JSON lines", async () => {
    const frames = framesToAsyncIterable([
      { event: "", data: "not json" },
      { event: "", data: '{"choices":[{"delta":{"content":"ok"}}]}' },
      { event: "", data: "[DONE]" },
    ]);
    const deltas = await collectDeltas(parseOpenAiSse(frames));
    expect(deltas[0]!.deltaText).toBe("ok");
  });

  it("extracts usage from terminal chunk when present", async () => {
    const frames = framesToAsyncIterable([
      {
        event: "",
        data: JSON.stringify({
          choices: [{ delta: { content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      },
      { event: "", data: "[DONE]" },
    ]);
    const deltas = await collectDeltas(parseOpenAiSse(frames));
    expect(deltas[0]!.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
    expect(deltas[0]!.done).toBe(true);
  });

  it("handles chunks with no content in delta (empty string)", async () => {
    const frames = framesToAsyncIterable([
      { event: "", data: '{"choices":[{"delta":{}}]}' },
      { event: "", data: '{"choices":[{"delta":{"content":"text"}}]}' },
      { event: "", data: "[DONE]" },
    ]);
    const deltas = await collectDeltas(parseOpenAiSse(frames));
    expect(deltas[0]!.deltaText).toBe("");
    expect(deltas[1]!.deltaText).toBe("text");
  });
});

// ─── parseAnthropicSse ──────────────────────────────────────────────────────

describe("parseAnthropicSse", () => {
  it("discriminates on event types", async () => {
    const frames = framesToAsyncIterable([
      {
        event: "message_start",
        data: JSON.stringify({
          message: { usage: { input_tokens: 5 } },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({ delta: { text: "Hello" } }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({ usage: { output_tokens: 10 } }),
      },
      {
        event: "message_stop",
        data: JSON.stringify({}),
      },
    ]);
    const deltas = await collectDeltas(parseAnthropicSse(frames));
    // content_block_delta yields text
    expect(deltas[0]!.deltaText).toBe("Hello");
    // message_stop yields done with usage
    expect(deltas[1]!.done).toBe(true);
    expect(deltas[1]!.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 10,
      total_tokens: 15,
    });
  });

  it("extracts text from content_block_delta events", async () => {
    const frames = framesToAsyncIterable([
      {
        event: "content_block_delta",
        data: JSON.stringify({ delta: { text: "chunk1" } }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({ delta: { text: "chunk2" } }),
      },
      { event: "message_stop", data: JSON.stringify({}) },
    ]);
    const deltas = await collectDeltas(parseAnthropicSse(frames));
    expect(deltas[0]!.deltaText).toBe("chunk1");
    expect(deltas[1]!.deltaText).toBe("chunk2");
  });

  it("captures input_tokens from message_start and output_tokens from message_delta", async () => {
    const frames = framesToAsyncIterable([
      {
        event: "message_start",
        data: JSON.stringify({ message: { usage: { input_tokens: 42 } } }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({ usage: { output_tokens: 58 } }),
      },
      { event: "message_stop", data: JSON.stringify({}) },
    ]);
    const deltas = await collectDeltas(parseAnthropicSse(frames));
    const final = deltas[deltas.length - 1]!;
    expect(final.usage).toEqual({
      prompt_tokens: 42,
      completion_tokens: 58,
      total_tokens: 100,
    });
  });

  it("returns final usage on message_stop", async () => {
    const frames = framesToAsyncIterable([
      {
        event: "message_start",
        data: JSON.stringify({ message: { usage: { input_tokens: 1 } } }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({ usage: { output_tokens: 2 } }),
      },
      { event: "message_stop", data: JSON.stringify({}) },
    ]);
    const deltas = await collectDeltas(parseAnthropicSse(frames));
    const stop = deltas.find((d) => d.done);
    expect(stop).toBeDefined();
    expect(stop!.usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    });
  });

  it("ignores ping and unknown events", async () => {
    const frames = framesToAsyncIterable([
      { event: "ping", data: JSON.stringify({}) },
      { event: "unknown_event", data: JSON.stringify({ foo: "bar" }) },
      {
        event: "content_block_delta",
        data: JSON.stringify({ delta: { text: "real" } }),
      },
      { event: "message_stop", data: JSON.stringify({}) },
    ]);
    const deltas = await collectDeltas(parseAnthropicSse(frames));
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.deltaText).toBe("real");
  });
});

// ─── parseGeminiSse ─────────────────────────────────────────────────────────

describe("parseGeminiSse", () => {
  it("extracts text from candidates[0].content.parts[].text", async () => {
    const stream = makeStream([
      "data: " +
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
        }) +
        "\n\n",
    ]);
    const deltas = await collectDeltas(parseGeminiSse(stream));
    expect(deltas[0]!.deltaText).toBe("Hello");
  });

  it("captures usageMetadata from final payload", async () => {
    const stream = makeStream([
      "data: " +
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "done" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            totalTokenCount: 15,
          },
        }) +
        "\n\n",
    ]);
    const deltas = await collectDeltas(parseGeminiSse(stream));
    const final = deltas[deltas.length - 1]!;
    expect(final.done).toBe(true);
    expect(final.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 10,
      total_tokens: 15,
    });
  });

  it("handles multi-part candidates", async () => {
    const stream = makeStream([
      "data: " +
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "part1" }, { text: "part2" }],
              },
            },
          ],
        }) +
        "\n\n",
    ]);
    const deltas = await collectDeltas(parseGeminiSse(stream));
    expect(deltas[0]!.deltaText).toBe("part1part2");
  });
});

// ─── parseClaudeCodeStream ──────────────────────────────────────────────────

describe("parseClaudeCodeStream", () => {
  it("extracts text from assistant type events (string content)", async () => {
    const stream = makeStream([
      JSON.stringify({ type: "assistant", content: "Hello" }) + "\n",
    ]);
    const deltas = await collectDeltas(parseClaudeCodeStream(stream));
    expect(deltas[0]!.deltaText).toBe("Hello");
    expect(deltas[0]!.done).toBe(false);
  });

  it("extracts text from assistant events with array content blocks", async () => {
    const stream = makeStream([
      JSON.stringify({
        type: "assistant",
        content: [
          { type: "text", text: "block1" },
          { type: "text", text: "block2" },
        ],
      }) + "\n",
    ]);
    const deltas = await collectDeltas(parseClaudeCodeStream(stream));
    expect(deltas[0]!.deltaText).toBe("block1block2");
  });

  it("terminates on result type events", async () => {
    const stream = makeStream([
      JSON.stringify({ type: "assistant", content: "hi" }) + "\n",
      JSON.stringify({ type: "result" }) + "\n",
      JSON.stringify({ type: "assistant", content: "after" }) + "\n",
    ]);
    const deltas = await collectDeltas(parseClaudeCodeStream(stream));
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.deltaText).toBe("hi");
    expect(deltas[1]!.done).toBe(true);
  });

  it("skips empty lines and malformed JSON", async () => {
    const stream = makeStream([
      "\n",
      "not json\n",
      JSON.stringify({ type: "assistant", content: "valid" }) + "\n",
      JSON.stringify({ type: "result" }) + "\n",
    ]);
    const deltas = await collectDeltas(parseClaudeCodeStream(stream));
    expect(deltas[0]!.deltaText).toBe("valid");
    expect(deltas[1]!.done).toBe(true);
  });
});

// ─── IdleTimeoutController ──────────────────────────────────────────────────

describe("IdleTimeoutController", () => {
  it("reset() extends the deadline", () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(100);
      vi.advanceTimersByTime(80);
      idle.reset();
      vi.advanceTimersByTime(80);
      expect(idle.signal.aborted).toBe(false);
      vi.advanceTimersByTime(30);
      expect(idle.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts signal after timeout with no reset", () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(50);
      expect(idle.signal.aborted).toBe(false);
      vi.advanceTimersByTime(50);
      expect(idle.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not abort if reset is called in time", () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(100);
      vi.advanceTimersByTime(90);
      idle.reset();
      vi.advanceTimersByTime(90);
      idle.reset();
      vi.advanceTimersByTime(90);
      expect(idle.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── accumulateStream ───────────────────────────────────────────────────────

describe("accumulateStream", () => {
  it("concatenates delta text", async () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(5000);
      const deltas = framesToAsyncIterable([
        { event: "", data: "" } as unknown as SSEFrame,
      ]);
      // Build a proper async iterable of StreamDelta
      async function* streamDeltas(): AsyncIterable<StreamDelta> {
        yield { deltaText: "Hello", done: false };
        yield { deltaText: " world", done: false };
        yield { deltaText: "", done: true };
      }
      const result = await accumulateStream(streamDeltas(), idle);
      expect(result.text).toBe("Hello world");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes through usage from last delta that has it", async () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(5000);
      const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
      async function* streamDeltas(): AsyncIterable<StreamDelta> {
        yield { deltaText: "text", done: false };
        yield { deltaText: "", usage, done: true };
      }
      const result = await accumulateStream(streamDeltas(), idle);
      expect(result.usage).toEqual(usage);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls idle.reset() on each chunk", async () => {
    vi.useFakeTimers();
    try {
      const idle = new IdleTimeoutController(5000);
      const resetSpy = vi.spyOn(idle, "reset");
      async function* streamDeltas(): AsyncIterable<StreamDelta> {
        yield { deltaText: "a", done: false };
        yield { deltaText: "b", done: false };
        yield { deltaText: "", done: true };
      }
      await accumulateStream(streamDeltas(), idle);
      expect(resetSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
