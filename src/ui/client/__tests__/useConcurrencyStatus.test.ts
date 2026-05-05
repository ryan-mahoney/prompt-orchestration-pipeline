import "../../components/__tests__/test-dom";

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useConcurrencyStatus } from "../hooks/useConcurrencyStatus";
import type { JobConcurrencyApiStatus } from "../types";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

type Listener = (event: MessageEvent<string>) => void;

class MockEventSource {
  public readonly url: string;
  public closed = false;
  public listeners = new Map<string, Listener>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    const listener = this.listeners.get(type);
    if (!listener) return;
    listener(new MessageEvent(type, { data: JSON.stringify(data) }));
  }

  static instances: MockEventSource[] = [];
  static reset(): void {
    MockEventSource.instances = [];
  }
}

const sampleStatus: JobConcurrencyApiStatus = {
  limit: 3,
  runningCount: 0,
  availableSlots: 3,
  queuedCount: 0,
  activeJobs: [],
  queuedJobs: [],
  staleSlots: [],
};

function makeStatus(overrides: Partial<JobConcurrencyApiStatus> = {}): JobConcurrencyApiStatus {
  return { ...sampleStatus, ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("useConcurrencyStatus", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    MockEventSource.reset();
    vi.restoreAllMocks();
  });

  it("populates data after the initial fetch", async () => {
    const status = makeStatus({ runningCount: 1, availableSlots: 2 });
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true, data: status }),
    ) as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const { result } = renderHook(() => useConcurrencyStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(status);
    expect(result.current.error).toBeNull();
  });

  it("refetches on state:summary SSE events", async () => {
    const first = makeStatus({ runningCount: 1 });
    const second = makeStatus({ runningCount: 2 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: first }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: second }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const { result } = renderHook(() => useConcurrencyStatus());

    await waitFor(() => expect(result.current.data).toEqual(first));

    act(() => {
      MockEventSource.instances[0]?.emit("state:summary", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toEqual(second));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts the in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const { unmount } = renderHook(() => useConcurrencyStatus());

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });
});
