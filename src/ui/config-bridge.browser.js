/**
 * Browser-safe configuration bridge.
 * Exports only lightweight, pure values usable in the client bundle.
 *
 * This file intentionally avoids Node APIs (fs/path/url) so it can be bundled by Vite.
 * Server-side code should import src/ui/config-bridge.node.js instead.
 */

export const Constants = {
  JOB_ID_REGEX: /^[A-Za-z0-9-_]+$/,
  TASK_STATES: ["pending", "running", "done", "error"],
  JOB_LOCATIONS: ["current", "complete"],
  STATUS_ORDER: ["running", "error", "pending", "complete"],
  FILE_LIMITS: {
    MAX_FILE_SIZE: 5 * 1024 * 1024,
  },
  SSE_CONFIG: {
    DEBOUNCE_MS: 200,
  },
  ERROR_CODES: {
    NOT_FOUND: "not_found",
    INVALID_JSON: "invalid_json",
    FS_ERROR: "fs_error",
    JOB_NOT_FOUND: "job_not_found",
    BAD_REQUEST: "bad_request",
  },
};

// Lightweight client-side config. Use Vite env override where available.
export const CONFIG = {
  useRealData: Boolean(
    // Vite exposes env under import.meta.env
    typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.VITE_UI_REAL_DATA === "1"
  ),
  logging: {
    level:
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_UI_LOG_LEVEL) ||
      "warn",
  },
};

// Provide a no-op PATHS placeholder for client code that may import it.
// Real filesystem paths are meaningless in the browser; consumers should not rely on them.
export const PATHS = {
  current: null,
  complete: null,
  pending: null,
  rejected: null,
};

// Minimal helper to create an error response shape (pure, browser-safe)
export function createErrorResponse(code, message, path = null) {
  const error = { ok: false, code, message };
  if (path) error.path = path;
  return error;
}
