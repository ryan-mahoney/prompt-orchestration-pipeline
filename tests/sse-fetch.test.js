import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSSE } from "../src/ui/client/sse-fetch.js";

describe("fetchSSE", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses single SSE event correctly", async () => {
    const events = [];
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: started\ndata: {"pipelineSlug":"test"}\n\n'
          )
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    const { cancel } = fetchSSE("/api/test", {}, (type, data) => {
      events.push({ type, data });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "started",
      data: { pipelineSlug: "test" },
    });
  });

  it("parses multiple SSE events in sequence", async () => {
    const events = [];
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: task:start\ndata: {"taskId":"task1"}\n\nevent: task:complete\ndata: {"taskId":"task1"}\n\n'
          )
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, (type, data) => {
      events.push({ type, data });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "task:start",
      data: { taskId: "task1" },
    });
    expect(events[1]).toEqual({
      type: "task:complete",
      data: { taskId: "task1" },
    });
  });

  it("handles chunked data across multiple reads", async () => {
    const events = [];
    const chunks = [
      new TextEncoder().encode('event: started\ndata: {"pipeline'),
      new TextEncoder().encode('Slug":"test"}\n\nevent: '),
      new TextEncoder().encode('complete\ndata: {"done":true}\n\n'),
    ];

    let chunkIndex = 0;
    const mockStream = new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          if (chunkIndex < chunks.length) {
            controller.enqueue(chunks[chunkIndex]);
            chunkIndex++;
          } else {
            clearInterval(interval);
            controller.close();
          }
        }, 10);
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, (type, data) => {
      events.push({ type, data });
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "started",
      data: { pipelineSlug: "test" },
    });
    expect(events[1]).toEqual({
      type: "complete",
      data: { done: true },
    });
  });

  it("calls onEvent with parsed event name and data", async () => {
    const mockOnEvent = vi.fn();
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: artifact:start\ndata: {"artifactName":"output.json","taskId":"task1"}\n\n'
          )
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, mockOnEvent);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOnEvent).toHaveBeenCalledTimes(1);
    expect(mockOnEvent).toHaveBeenCalledWith("artifact:start", {
      artifactName: "output.json",
      taskId: "task1",
    });
  });

  it("cancel() aborts the fetch", async () => {
    const mockAbort = vi.fn();
    const mockController = {
      signal: {},
      abort: mockAbort,
    };
    const originalAbortController = global.AbortController;

    global.AbortController = vi.fn(() => mockController);
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            // Never close the stream to simulate long-running connection
          },
        }),
      })
    );

    const { cancel } = fetchSSE("/api/test", {}, () => {});
    cancel();

    expect(mockAbort).toHaveBeenCalled();

    global.AbortController = originalAbortController;
  });

  it("throws when onEvent is not a function", () => {
    expect(() => {
      fetchSSE("/api/test", {});
    }).toThrow("onEvent callback is required");
  });

  it("defaults method to POST", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("event: started\ndata: {}\n\n")
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, () => {});

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("allows overriding method in options", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("event: started\ndata: {}\n\n")
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", { method: "GET" }, () => {});

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("handles HTTP errors with JSON error response", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const errorResponse = {
      ok: false,
      code: "analysis_locked",
      heldBy: "content-generation",
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        statusText: "Conflict",
        body: mockStream,
        json: () => Promise.resolve(errorResponse),
      })
    );

    const mockOnError = vi.fn();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    fetchSSE("/api/test", {}, () => {}, mockOnError);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockOnError).toHaveBeenCalledWith(errorResponse);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles HTTP errors with non-JSON response", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        body: mockStream,
        json: () => Promise.reject(new Error("Invalid JSON")),
      })
    );

    const mockOnError = vi.fn();

    fetchSSE("/api/test", {}, () => {}, mockOnError);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockOnError).toHaveBeenCalledWith({
      ok: false,
      code: "http_error",
      message: "Internal Server Error",
      status: 500,
    });
  });

  it("handles HTTP errors without onError callback", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const errorResponse = {
      ok: false,
      code: "not_found",
      message: "Pipeline not found",
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        body: mockStream,
        json: () => Promise.resolve(errorResponse),
      })
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    fetchSSE("/api/test", {}, () => {});

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[sse-fetch] HTTP 404:",
      errorResponse
    );

    consoleErrorSpy.mockRestore();
  });

  it("ignores empty events", async () => {
    const events = [];
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            "\n\nevent: started\ndata: {}\n\n\n\nevent: complete\ndata: {}\n\n"
          )
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, (type, data) => {
      events.push({ type, data });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("started");
    expect(events[1].type).toBe("complete");
  });

  it("handles events with extra whitespace", async () => {
    const events = [];
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '  event: started  \n  data: {"test":true}  \n\n'
          )
        );
        controller.close();
      },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      })
    );

    fetchSSE("/api/test", {}, (type, data) => {
      events.push({ type, data });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "started",
      data: { test: true },
    });
  });
});
