/**
 * Job detail endpoint
 *
 * Exports handler:
 *  - getJobDetailHandler(req, res)
 *
 * Uses job-reader to fetch detail and returns 200/404/400 accordingly.
 */

import { readJob } from "../job-reader.js";

export async function getJobDetailHandler(req, res) {
  const { jobId } = req.params || {};

  try {
    const result = await readJob(jobId);

    if (!result.ok) {
      // Map known error codes to HTTP statuses
      if (result.code === "bad_request") {
        return res.status(400).json(result);
      }
      if (result.code === "job_not_found") {
        return res.status(404).json(result);
      }

      return res.status(500).json(result);
    }

    // Build the detail shape (do not include artifact file contents)
    const data = result.data || {};
    const tasksArray =
      data.tasks && typeof data.tasks === "object"
        ? Object.entries(data.tasks).map(([name, t]) => ({
            name,
            state: t.state,
            startedAt: t.startedAt,
            endedAt: t.endedAt,
            attempts: t.attempts,
            executionTimeMs: t.executionTimeMs,
            artifacts: t.artifacts || [],
          }))
        : [];

    const payload = {
      id: data.id || jobId,
      name: data.name || jobId,
      status: data.status || undefined,
      progress: typeof data.progress === "number" ? data.progress : 0,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      location: result.location || null,
      tasks: tasksArray,
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Error in getJobDetailHandler:", err);
    return res.status(500).json({
      ok: false,
      code: "fs_error",
      message: "Internal server error",
    });
  }
}
