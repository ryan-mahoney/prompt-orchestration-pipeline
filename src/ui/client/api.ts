import type {
  ApiError,
  ApiErrorCode,
  ApiOkResponse,
  JobConcurrencyApiStatus,
  RestartJobOptions,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBackendErrorCode(errorData: unknown, status: number): ApiErrorCode {
  if (!isRecord(errorData) || typeof errorData["code"] !== "string") {
    return getErrorCodeFromStatus(status);
  }

  const code = errorData["code"];
  if (
    code === "job_running" ||
    code === "job_not_found" ||
    code === "conflict" ||
    code === "spawn_failed" ||
    code === "unknown_error" ||
    code === "network_error" ||
    code === "dependencies_not_satisfied" ||
    code === "unsupported_lifecycle" ||
    code === "task_not_found" ||
    code === "task_not_pending"
  ) {
    return code;
  }
  if (code === "JOB_NOT_FOUND" || code === "NOT_FOUND") return "job_not_found";
  if (code === "JOB_RUNNING") return "job_running";
  if (code === "SPAWN_FAILED") return "spawn_failed";
  if (code === "TASK_NOT_FOUND") return "task_not_found";
  if (code === "TASK_NOT_PENDING") return "task_not_pending";
  if (code === "UNSUPPORTED_LIFECYCLE") return "unsupported_lifecycle";
  if (code === "DEPENDENCIES_NOT_SATISFIED") return "dependencies_not_satisfied";
  if (code === "BAD_REQUEST" && status === 409) return "conflict";
  return getErrorCodeFromStatus(status);
}

function getMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value["message"] === "string" ? value["message"] : null;
}

export function getErrorCodeFromStatus(status: number): ApiErrorCode {
  if (status === 404) return "job_not_found";
  if (status === 409) return "conflict";
  if (status === 412) return "dependencies_not_satisfied";
  if (status === 422) return "task_not_pending";
  if (status === 501) return "unsupported_lifecycle";
  if (status >= 500) return "unknown_error";
  return "unknown_error";
}

export function getErrorMessageFromStatus(status: number): string {
  if (status === 404) return "Job not found";
  if (status === 409) return "The requested action conflicts with the current job state";
  if (status === 412) return "Task dependencies are not satisfied";
  if (status === 422) return "Task is not pending";
  if (status === 501) return "This lifecycle action is not supported";
  if (status >= 500) return "The server failed to process the request";
  return "Request failed";
}

export function getRestartErrorMessage(errorData: unknown, status: number): string {
  if (isRecord(errorData) && errorData["code"] === "job_running") {
    return "Cannot restart a job while it is still running";
  }
  if (isRecord(errorData) && errorData["code"] === "spawn_failed") {
    return "Failed to spawn the restarted job";
  }
  return getMessage(errorData) ?? getErrorMessageFromStatus(status);
}

export function getStartTaskErrorMessage(errorData: unknown, status: number): string {
  if (isRecord(errorData) && errorData["code"] === "dependencies_not_satisfied") {
    return "Cannot start task before its dependencies are complete";
  }
  if (isRecord(errorData) && errorData["code"] === "task_not_found") {
    return "Task not found";
  }
  if (isRecord(errorData) && errorData["code"] === "task_not_pending") {
    return "Only pending tasks can be started";
  }
  return getMessage(errorData) ?? getErrorMessageFromStatus(status);
}

export function getStopErrorMessage(errorData: unknown, status: number): string {
  if (isRecord(errorData) && errorData["code"] === "job_not_found") {
    return "Job not found";
  }
  if (isRecord(errorData) && errorData["code"] === "unsupported_lifecycle") {
    return "This job cannot be stopped";
  }
  return getMessage(errorData) ?? getErrorMessageFromStatus(status);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toApiError(status: number, message: string, errorData?: unknown): ApiError {
  return {
    code: normalizeBackendErrorCode(errorData, status),
    message,
    status,
  };
}

async function postJson(
  url: string,
  body: unknown,
  getFailureMessage: (errorData: unknown, status: number) => string,
): Promise<ApiOkResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw {
      code: "network_error",
      message: error instanceof Error ? error.message : "Network request failed",
    } satisfies ApiError;
  }

  const payload = await parseJson(response);
  if (response.ok) {
    if (isRecord(payload) && payload["ok"] === true) {
      return {
        ok: true,
        message: typeof payload["message"] === "string" ? payload["message"] : undefined,
      };
    }
    return { ok: true };
  }

  throw toApiError(response.status, getFailureMessage(payload, response.status), payload);
}

export async function restartJob(jobId: string, opts: RestartJobOptions = {}): Promise<ApiOkResponse> {
  const clearTokenUsage = opts.options?.clearTokenUsage ?? true;
  return postJson(`/api/jobs/${jobId}/restart`, {
    ...opts,
    options: {
      ...opts.options,
      clearTokenUsage,
    },
  }, getRestartErrorMessage);
}

export async function rescanJob(jobId: string): Promise<ApiOkResponse> {
  return postJson(`/api/jobs/${jobId}/rescan`, {}, (_errorData, status) => getErrorMessageFromStatus(status));
}

export async function startTask(jobId: string, taskId: string): Promise<ApiOkResponse> {
  return postJson(`/api/jobs/${jobId}/tasks/${taskId}/start`, {}, getStartTaskErrorMessage);
}

export async function stopJob(jobId: string): Promise<ApiOkResponse> {
  return postJson(`/api/jobs/${jobId}/stop`, {}, getStopErrorMessage);
}

export async function fetchConcurrencyStatus(
  signal?: AbortSignal,
): Promise<JobConcurrencyApiStatus> {
  let response: Response;

  try {
    response = await fetch("/api/concurrency", { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw {
      code: "network_error",
      message: error instanceof Error ? error.message : "Network request failed",
    } satisfies ApiError;
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    throw toApiError(
      response.status,
      getMessage(payload) ?? getErrorMessageFromStatus(response.status),
      payload,
    );
  }

  if (
    isRecord(payload) &&
    payload["ok"] === true &&
    isRecord(payload["data"])
  ) {
    return payload["data"] as unknown as JobConcurrencyApiStatus;
  }

  throw {
    code: "unknown_error",
    message: "Malformed concurrency status response",
    status: response.status,
  } satisfies ApiError;
}
