import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchConcurrencyStatus, restartJob, startTask, stopJob } from "../api";
import type { JobConcurrencyApiStatus } from "../types";

const fetchMock = vi.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

describe("ui client api", () => {
  afterEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = originalFetch;
  });

  it("posts restart requests and defaults clearTokenUsage to true", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, message: "queued" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await restartJob("job-1", { fromTask: "build" });

    expect(result).toEqual({ ok: true, message: "queued" });
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/job-1/restart", expect.objectContaining({
      method: "POST",
    }));
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      fromTask: "build",
      options: { clearTokenUsage: true },
    });
  });

  it("throws structured errors on failed restart", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "job_running" }), { status: 409 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartJob("job-1")).rejects.toMatchObject({
      code: "job_running",
      status: 409,
    });
  });

  it("preserves concurrency_limit_reached on restart and surfaces capacity message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "concurrency_limit_reached",
          message: "concurrency limit reached",
        }),
        { status: 409 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(restartJob("job-1")).rejects.toMatchObject({
      code: "concurrency_limit_reached",
      status: 409,
      message: "Capacity reached. Wait for a job to finish, then try again.",
    });
  });

  it("preserves concurrency_limit_reached on task start and surfaces capacity message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "concurrency_limit_reached",
          message: "concurrency limit reached",
        }),
        { status: 409 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(startTask("job-1", "task-1")).rejects.toMatchObject({
      code: "concurrency_limit_reached",
      status: 409,
      message: "Capacity reached. Wait for a job to finish, then try again.",
    });
  });

  it("returns ok responses for stop", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(stopJob("job-1")).resolves.toEqual({ ok: true });
  });

  it("maps network failures to network_error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(stopJob("job-1")).rejects.toMatchObject({
      code: "network_error",
      message: "offline",
    });
  });

  describe("fetchConcurrencyStatus", () => {
    const sampleStatus: JobConcurrencyApiStatus = {
      limit: 3,
      runningCount: 1,
      availableSlots: 2,
      queuedCount: 1,
      activeJobs: [
        { jobId: "job-1", pid: 1234, acquiredAt: "2024-01-01T00:00:00Z", source: "orchestrator" },
      ],
      queuedJobs: [
        { jobId: "job-2", queuedAt: "2024-01-01T00:00:01Z", name: "second", pipeline: "demo" },
      ],
      staleSlots: [],
    };

    it("parses a successful response and unwraps data", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: sampleStatus }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(fetchConcurrencyStatus()).resolves.toEqual(sampleStatus);
      expect(fetchMock).toHaveBeenCalledWith("/api/concurrency", expect.objectContaining({}));
    });

    it("maps network failures to network_error", async () => {
      fetchMock.mockRejectedValue(new Error("offline"));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(fetchConcurrencyStatus()).rejects.toMatchObject({
        code: "network_error",
        message: "offline",
      });
    });

    it("propagates abort signals to fetch", async () => {
      fetchMock.mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const controller = new AbortController();
      const promise = fetchConcurrencyStatus(controller.signal);
      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });
  });
});
