/**
 * Client-side API helpers for making HTTP requests to the backend
 */

/**
 * Restart a job with clean-slate mode
 *
 * @param {string} jobId - The ID of the job to restart
 * @param {Object} opts - Options object
 * @param {Object} opts.options - Additional options for the restart
 * @param {boolean} opts.options.clearTokenUsage - Whether to clear token usage (default: true)
 * @returns {Promise<Object>} Parsed JSON response from the server
 * @throws {Object} Structured error object with { code, message } for non-2xx responses
 */
export async function restartJob(jobId, opts = {}) {
  const options = {
    clearTokenUsage: true,
    ...opts.options,
  };

  const requestBody = opts.fromTask
    ? { fromTask: opts.fromTask, options }
    : { mode: "clean-slate", options };

  try {
    const response = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/restart`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      // Try to parse error response, fall back to status text if parsing fails
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: response.statusText };
      }

      // Throw structured error with code and message
      throw {
        code: errorData.code || getErrorCodeFromStatus(response.status),
        message: getRestartErrorMessage(errorData, response.status),
        status: response.status,
      };
    }

    // Return parsed JSON for successful responses
    return await response.json();
  } catch (error) {
    // Re-throw structured errors as-is
    if (error.code && error.message) {
      throw error;
    }

    // Handle network errors or other unexpected errors
    throw {
      code: "network_error",
      message: error.message || "Failed to connect to server",
    };
  }
}

/**
 * Map HTTP status codes to error codes for structured error handling
 */
function getErrorCodeFromStatus(status) {
  switch (status) {
    case 404:
      return "job_not_found";
    case 409:
      return "conflict";
    case 500:
      return "spawn_failed";
    default:
      return "unknown_error";
  }
}

/**
 * Map HTTP status codes to error messages for structured error handling
 */
function getErrorMessageFromStatus(status) {
  switch (status) {
    case 404:
      return "Job not found";
    case 409:
      return "Job restart conflict";
    case 500:
      return "Failed to start restart";
    default:
      return `Request failed with status ${status}`;
  }
}

/**
 * Get specific error message from error response for restart functionality
 */
function getRestartErrorMessage(errorData, status) {
  // Handle specific 409 conflict errors
  if (status === 409) {
    if (errorData.code === "job_running") {
      return "Job is currently running; restart is unavailable.";
    }
    if (errorData.code === "unsupported_lifecycle") {
      return "Job must be in current to restart.";
    }
    if (errorData.message?.includes("job_running")) {
      return "Job is currently running; restart is unavailable.";
    }
    if (errorData.message?.includes("unsupported_lifecycle")) {
      return "Job must be in current to restart.";
    }
  }

  // Handle 404 errors
  if (status === 404) {
    return "Job not found.";
  }

  // Handle 500 errors
  if (status === 500) {
    return "Failed to start restart. Try again.";
  }

  // Fall back to provided message or default
  return errorData.message || "Failed to restart job.";
}
