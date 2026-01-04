import { promises as fs } from "node:fs";
import path from "node:path";
import { streamSSE } from "../lib/sse.js";
import { acquireLock, releaseLock } from "../lib/analysis-lock.js";
import { getPipelineConfig } from "../../core/config.js";
import { analyzeTask } from "../../task-analysis/index.js";
import { writeAnalysisFile } from "../../task-analysis/enrichers/analysis-writer.js";
import { deduceArtifactSchema } from "../../task-analysis/enrichers/schema-deducer.js";
import { writeSchemaFiles } from "../../task-analysis/enrichers/schema-writer.js";
import { resolveArtifactReference } from "../../task-analysis/enrichers/artifact-resolver.js";

/**
 * Handle pipeline analysis endpoint.
 * Analyzes all tasks in a pipeline and deduces schemas for artifacts.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export async function handlePipelineAnalysis(req, res) {
  const slug = req.params.slug;
  const startTime = Date.now();

  // Validate slug format
  if (!slug || typeof slug !== "string") {
    return res.status(400).json({
      ok: false,
      code: "invalid_slug",
      message: "Missing or invalid slug parameter",
    });
  }

  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    return res.status(400).json({
      ok: false,
      code: "invalid_slug",
      message:
        "Invalid slug format: only alphanumeric, hyphens, and underscores allowed",
    });
  }

  // Try to acquire lock
  const lockResult = acquireLock(slug);
  if (!lockResult.acquired) {
    return res.status(409).json({
      ok: false,
      code: "analysis_locked",
      heldBy: lockResult.heldBy,
    });
  }

  // Create SSE stream
  const stream = streamSSE(res);
  let lockReleased = false;

  const releaseLockSafely = () => {
    if (!lockReleased) {
      releaseLock(slug);
      lockReleased = true;
    }
  };

  // Handle client disconnect
  req.on("close", () => {
    console.log(`[PipelineAnalysis] Client disconnected for ${slug}`);
    releaseLockSafely();
  });

  try {
    // Get pipeline configuration
    let pipelineConfig;
    try {
      pipelineConfig = getPipelineConfig(slug);
    } catch (error) {
      stream.send("error", {
        message: `Pipeline '${slug}' not found in registry`,
      });
      stream.end();
      releaseLockSafely();
      return;
    }

    const pipelineDir = path.dirname(pipelineConfig.pipelineJsonPath);

    // Read pipeline.json
    let pipelineData;
    try {
      const contents = await fs.readFile(
        pipelineConfig.pipelineJsonPath,
        "utf8"
      );
      pipelineData = JSON.parse(contents);
    } catch (error) {
      stream.send("error", {
        message: `Failed to read pipeline.json: ${error.message}`,
      });
      stream.end();
      releaseLockSafely();
      return;
    }

    if (!Array.isArray(pipelineData.tasks)) {
      stream.send("error", {
        message: "Invalid pipeline.json: tasks array not found",
      });
      stream.end();
      releaseLockSafely();
      return;
    }

    const tasks = pipelineData.tasks;
    const totalTasks = tasks.length;

    // Pre-analyze all tasks to count total artifacts (only JSON files need schema deduction)
    const taskAnalyses = [];
    let totalArtifacts = 0;

    for (const taskId of tasks) {
      const taskFilePath = path.join(pipelineDir, "tasks", `${taskId}.js`);
      try {
        const taskCode = await fs.readFile(taskFilePath, "utf8");
        const analysis = analyzeTask(taskCode, taskFilePath);
        taskAnalyses.push({ taskId, taskCode, analysis });
        // Only count JSON artifacts for schema deduction
        totalArtifacts += analysis.artifacts.writes.filter((a) =>
          a.fileName.endsWith(".json")
        ).length;
      } catch (error) {
        stream.send("error", {
          message: `Failed to analyze task '${taskId}': ${error.message}`,
          taskId,
        });
        stream.end();
        releaseLockSafely();
        return;
      }
    }

    // Collect all known artifact filenames from writes for LLM resolution
    const allKnownArtifacts = taskAnalyses.flatMap((t) =>
      t.analysis.artifacts.writes.map((w) => w.fileName)
    );

    // Send started event
    stream.send("started", {
      pipelineSlug: slug,
      totalTasks,
      totalArtifacts,
    });

    let completedTasks = 0;
    let completedArtifacts = 0;

    // Process each task
    for (let taskIndex = 0; taskIndex < taskAnalyses.length; taskIndex++) {
      const { taskId, taskCode, analysis } = taskAnalyses[taskIndex];

      stream.send("task:start", {
        taskId,
        taskIndex,
        totalTasks,
      });

      // Write analysis file
      try {
        await writeAnalysisFile(pipelineDir, taskId, analysis);
      } catch (error) {
        stream.send("error", {
          message: `Failed to write analysis for task '${taskId}': ${error.message}`,
          taskId,
        });
        stream.end();
        releaseLockSafely();
        return;
      }

      // Resolve unresolved artifact references using LLM
      const unresolvedReads = analysis.artifacts.unresolvedReads || [];
      const unresolvedWrites = analysis.artifacts.unresolvedWrites || [];

      for (const unresolved of unresolvedReads) {
        try {
          const resolution = await resolveArtifactReference(
            taskCode,
            unresolved,
            allKnownArtifacts
          );
          if (resolution.confidence >= 0.7 && resolution.resolvedFileName) {
            analysis.artifacts.reads.push({
              fileName: resolution.resolvedFileName,
              stage: unresolved.stage,
              required: unresolved.required,
            });
          }
        } catch {
          // Silently skip failed resolutions
        }
      }

      for (const unresolved of unresolvedWrites) {
        try {
          const resolution = await resolveArtifactReference(
            taskCode,
            unresolved,
            allKnownArtifacts
          );
          if (resolution.confidence >= 0.7 && resolution.resolvedFileName) {
            analysis.artifacts.writes.push({
              fileName: resolution.resolvedFileName,
              stage: unresolved.stage,
            });
          }
        } catch {
          // Silently skip failed resolutions
        }
      }

      // Process each artifact write
      const artifacts = analysis.artifacts.writes;
      let jsonArtifactIndex = 0;

      for (
        let artifactIndex = 0;
        artifactIndex < artifacts.length;
        artifactIndex++
      ) {
        const artifact = artifacts[artifactIndex];

        // Skip non-JSON artifacts (only JSON files need schema deduction)
        if (!artifact.fileName.endsWith(".json")) {
          continue;
        }

        stream.send("artifact:start", {
          taskId,
          artifactName: artifact.fileName,
          artifactIndex: jsonArtifactIndex,
          totalArtifacts,
        });

        try {
          const deducedSchema = await deduceArtifactSchema(taskCode, artifact);
          await writeSchemaFiles(pipelineDir, artifact.fileName, deducedSchema);
        } catch (error) {
          stream.send("error", {
            message: `Failed to deduce schema for artifact '${artifact.fileName}': ${error.message}`,
            taskId,
            artifactName: artifact.fileName,
          });
          stream.end();
          releaseLockSafely();
          return;
        }

        stream.send("artifact:complete", {
          taskId,
          artifactName: artifact.fileName,
          artifactIndex: jsonArtifactIndex,
          totalArtifacts,
        });

        completedArtifacts++;
        jsonArtifactIndex++;
      }

      stream.send("task:complete", {
        taskId,
        taskIndex,
        totalTasks,
      });

      completedTasks++;
    }

    // Send complete event
    const durationMs = Date.now() - startTime;
    stream.send("complete", {
      pipelineSlug: slug,
      tasksAnalyzed: completedTasks,
      artifactsProcessed: completedArtifacts,
      durationMs,
    });

    stream.end();
    releaseLockSafely();
  } catch (error) {
    console.error(`[PipelineAnalysis] Unexpected error:`, error);
    stream.send("error", {
      message: `Unexpected error: ${error.message}`,
    });
    stream.end();
    releaseLockSafely();
  }
}
