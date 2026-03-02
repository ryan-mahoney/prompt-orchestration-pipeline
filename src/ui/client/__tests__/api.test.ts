import { afterEach, describe, expect, it, vi } from "vitest";

import { restartJob, stopJob } from "../api";

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
});
