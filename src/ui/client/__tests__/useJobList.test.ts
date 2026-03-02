import { afterEach, describe, expect, it, vi } from "vitest";

import { extractJobList, fetchJobList } from "../hooks/useJobList";

const originalFetch = globalThis.fetch;

describe("useJobList helpers", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("extracts wrapped responses", () => {
    expect(extractJobList({ ok: true, data: [{ jobId: "job-1" }] })).toEqual([{ jobId: "job-1" }]);
  });

  it("extracts bare arrays", () => {
    expect(extractJobList([{ jobId: "job-1" }])).toEqual([{ jobId: "job-1" }]);
  });

  it("fetches and adapts jobs", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ jobId: "job-1", tasks: {} }]), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(fetchJobList()).resolves.toMatchObject([{ jobId: "job-1" }]);
  });

  it("passes abort signals through to fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();

    await fetchJobList(controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
