/**
 * Handle GET /api/state endpoint
 */
import * as state from "../state.js";
import { sendJson } from "../utils/http-utils.js";

export async function handleApiState(req, res) {
  if (req.method !== "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: "Method not allowed",
        allowed: ["GET"],
      })
    );
    return;
  }

  // Prefer returning in-memory state when available (tests and runtime rely on state.getState()).
  // If in-memory state is available, return it directly; otherwise fall back to
  // building a filesystem-backed snapshot for client bootstrap.
  try {
    try {
      if (state && typeof state.getState === "function") {
        const inMemory = state.getState();
        if (inMemory) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(inMemory));
          return;
        }
      }
    } catch (innerErr) {
      // If reading in-memory state throws for some reason, fall back to snapshot
      console.warn("Warning: failed to retrieve in-memory state:", innerErr);
    }

    // Build a filesystem-backed snapshot for client bootstrap.
    // Dynamically import the composer and dependencies to avoid circular import issues.
    const [
      { buildSnapshotFromFilesystem },
      jobScannerModule,
      jobReaderModule,
      statusTransformerModule,
      configBridgeModule,
    ] = await Promise.all([
      import("../state-snapshot.js"),
      import("../job-scanner.js").catch(() => null),
      import("../job-reader.js").catch(() => null),
      import("../transformers/status-transformer.js").catch(() => null),
      import("../config-bridge.js").catch(() => null),
    ]);

    const snapshot = await buildSnapshotFromFilesystem({
      listAllJobs:
        jobScannerModule && jobScannerModule.listAllJobs
          ? jobScannerModule.listAllJobs
          : undefined,
      readJob:
        jobReaderModule && jobReaderModule.readJob
          ? jobReaderModule.readJob
          : undefined,
      transformMultipleJobs:
        statusTransformerModule && statusTransformerModule.transformMultipleJobs
          ? statusTransformerModule.transformMultipleJobs
          : undefined,
      now: () => new Date(),
      paths: (configBridgeModule && configBridgeModule.PATHS) || undefined,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot));
  } catch (err) {
    console.error("Failed to build /api/state snapshot:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        code: "snapshot_error",
        message: "Failed to build state snapshot",
        details: err && err.message ? err.message : String(err),
      })
    );
  }
}
