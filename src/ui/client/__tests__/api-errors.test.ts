import { describe, expect, it } from "vitest";

import {
  getErrorCodeFromStatus,
  getRestartErrorMessage,
  getStopErrorMessage,
  restartJob,
} from "../api";

describe("ui client api error helpers", () => {
  it("maps status codes to semantic error codes", () => {
    expect(getErrorCodeFromStatus(404)).toBe("job_not_found");
    expect(getErrorCodeFromStatus(409)).toBe("conflict");
    expect(getErrorCodeFromStatus(500)).toBe("unknown_error");
  });

  it("returns restart-specific messages", () => {
    expect(getRestartErrorMessage({ code: "job_running" }, 409)).toBe(
      "Cannot restart a job while it is still running",
    );
    expect(getRestartErrorMessage({ code: "spawn_failed" }, 500)).toBe(
      "Failed to spawn the restarted job",
    );
  });

  it("handles stop error payloads", () => {
    expect(getStopErrorMessage({ code: "job_not_found" }, 404)).toBe("Job not found");
    expect(getStopErrorMessage({ message: "custom" }, 500)).toBe("custom");
  });

  it("normalizes backend error codes into ApiErrorCode values", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: "BAD_REQUEST", message: "restart already in progress" }), {
        status: 409,
      })) as unknown as typeof fetch;

    await expect(restartJob("job-1")).rejects.toMatchObject({ code: "conflict" });
    globalThis.fetch = originalFetch;
  });
});
