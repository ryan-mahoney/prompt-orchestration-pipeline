import fs from "node:fs/promises";
import path from "node:path";

/**
 * Initialize status snapshot from artifacts in the filesystem
 * @param {Object} options - Options object
 * @param {string} options.jobDir - Job directory path
 * @param {Object} options.pipeline - Pipeline configuration object
 * @returns {Promise<Function>} Function that applies artifact initialization to a snapshot
 */
export async function initializeStatusFromArtifacts({ jobDir, pipeline }) {
  if (!jobDir || typeof jobDir !== "string") {
    throw new Error("jobDir must be a non-empty string");
  }

  if (!pipeline || typeof pipeline !== "object") {
    throw new Error("pipeline must be an object");
  }

  const artifactsDir = path.join(jobDir, "files", "artifacts");
  let artifactFilenames = [];

  try {
    // Read artifacts directory
    const entries = await fs.readdir(artifactsDir, { withFileTypes: true });

    // Collect filenames for regular files only
    artifactFilenames = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    console.log("[STATUS_INIT] Found artifacts in directory", {
      artifactsDir,
      artifactCount: artifactFilenames.length,
      artifactNames: artifactFilenames,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      // Directory doesn't exist, no artifacts to initialize
      console.log(
        "[STATUS_INIT] Artifacts directory does not exist, skipping initialization",
        {
          artifactsDir,
        }
      );
    } else {
      console.error("[STATUS_INIT] Failed to read artifacts directory", {
        artifactsDir,
        error: error.message,
      });
    }
    // Return a no-op function for non-existent or unreadable directory
    return (snapshot) => snapshot;
  }

  // Determine first task ID from pipeline
  const firstTaskId = Array.isArray(pipeline.tasks) ? pipeline.tasks[0] : null;
  console.log("[STATUS_INIT] Determined first task", {
    firstTaskId,
    hasTasks: Array.isArray(pipeline.tasks),
    taskCount: pipeline.tasks?.length || 0,
  });

  // Return function that applies the artifact initialization to a snapshot
  return function apply(snapshot) {
    console.log("[STATUS_INIT] Applying artifact initialization to snapshot", {
      existingArtifacts: snapshot.files?.artifacts?.length || 0,
      newArtifacts: artifactFilenames.length,
      firstTaskId,
    });

    // Ensure files object exists with proper structure
    if (!snapshot.files || typeof snapshot.files !== "object") {
      snapshot.files = { artifacts: [], logs: [], tmp: [] };
    } else {
      // Ensure each files array exists
      for (const type of ["artifacts", "logs", "tmp"]) {
        if (!Array.isArray(snapshot.files[type])) {
          snapshot.files[type] = [];
        }
      }
    }

    // Add artifact filenames to root level (deduplicate)
    const existingArtifacts = new Set(snapshot.files.artifacts || []);
    for (const filename of artifactFilenames) {
      if (!existingArtifacts.has(filename)) {
        snapshot.files.artifacts.push(filename);
        existingArtifacts.add(filename);
      }
    }

    // Add artifact filenames to first task (if it exists)
    if (firstTaskId) {
      // Ensure tasks object exists
      if (!snapshot.tasks || typeof snapshot.tasks !== "object") {
        snapshot.tasks = {};
      }

      // Ensure first task exists
      if (!snapshot.tasks[firstTaskId]) {
        snapshot.tasks[firstTaskId] = {};
      }

      // Ensure task files object exists with proper structure
      if (
        !snapshot.tasks[firstTaskId].files ||
        typeof snapshot.tasks[firstTaskId].files !== "object"
      ) {
        snapshot.tasks[firstTaskId].files = {
          artifacts: [],
          logs: [],
          tmp: [],
        };
      } else {
        // Ensure each task files array exists
        for (const type of ["artifacts", "logs", "tmp"]) {
          if (!Array.isArray(snapshot.tasks[firstTaskId].files[type])) {
            snapshot.tasks[firstTaskId].files[type] = [];
          }
        }
      }

      // Add artifact filenames to first task (deduplicate)
      const existingTaskArtifacts = new Set(
        snapshot.tasks[firstTaskId].files.artifacts || []
      );
      for (const filename of artifactFilenames) {
        if (!existingTaskArtifacts.has(filename)) {
          snapshot.tasks[firstTaskId].files.artifacts.push(filename);
          existingTaskArtifacts.add(filename);
        }
      }

      console.log("[STATUS_INIT] Added artifacts to first task", {
        firstTaskId,
        taskArtifactCount: snapshot.tasks[firstTaskId].files.artifacts.length,
        artifactNames: artifactFilenames,
      });
    }

    console.log("[STATUS_INIT] Final snapshot state", {
      rootArtifacts: snapshot.files.artifacts.length,
      rootArtifactNames: snapshot.files.artifacts,
      firstTaskArtifacts: firstTaskId
        ? snapshot.tasks[firstTaskId].files.artifacts.length
        : 0,
      firstTaskArtifactNames: firstTaskId
        ? snapshot.tasks[firstTaskId].files.artifacts
        : [],
    });

    return snapshot;
  };
}
