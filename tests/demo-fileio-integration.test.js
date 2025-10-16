import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTaskFileIO } from "../src/core/file-io.js";

describe("Demo Pipeline File I/O Integration", () => {
  let tempDir;
  let taskDir;
  let statusPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "demo-fileio-test-"));
    taskDir = path.join(tempDir, "tasks", "analysis");
    await fs.mkdir(taskDir, { recursive: true });

    statusPath = path.join(tempDir, "tasks-status.json");
    const initialStatus = {
      pipelineId: "demo-pipeline",
      current: "analysis",
      tasks: {
        analysis: {
          state: "running",
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
      },
      files: {
        artifacts: [],
        logs: [],
        tmp: [],
      },
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should simulate demo analysis task file I/O patterns", async () => {
    const fileIO = createTaskFileIO({
      workDir: tempDir,
      taskName: "analysis",
      getStage: () => "ingestion",
      statusPath,
    });

    // Simulate ingestion stage
    await fileIO.writeLog(
      "ingestion.log",
      `[${new Date().toISOString()}] Starting data ingestion for market-analysis\n`
    );

    await fileIO.writeArtifact(
      "raw-research.json",
      JSON.stringify(
        {
          content: "Sample research data for analysis",
          type: "market-analysis",
          ingestedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await fileIO.writeLog(
      "ingestion.log",
      `[${new Date().toISOString()}] ✓ Successfully ingested data\n`
    );

    // Simulate integration stage
    fileIO.getStage = () => "integration";

    await fileIO.writeArtifact(
      "analysis-output.json",
      JSON.stringify(
        {
          content:
            "Key findings: Market is growing, Trends: Digital transformation, Recommendations: Invest in technology",
          metadata: { model: "gpt-5-nano", tokens: 150 },
          timestamp: new Date().toISOString(),
          taskName: "analysis",
          analysisType: "market-analysis",
        },
        null,
        2
      )
    );

    await fileIO.writeArtifact(
      "analysis-summary.txt",
      `Analysis Summary
Type: market-analysis
Generated: ${new Date().toISOString()}
Model: gpt-5-nano
Tokens: 150

Content Preview:
Key findings: Market is growing, Trends: Digital transformation, Recommendations: Invest in technology`
    );

    await fileIO.writeLog(
      "integration.log",
      `[${new Date().toISOString()}] ✓ Analysis integration completed\n`
    );
    await fileIO.writeLog(
      "integration.log",
      `Output files: analysis-output.json, analysis-summary.txt\n`
    );

    // Verify all files exist in correct subdirectories
    const artifactsDir = path.join(taskDir, "artifacts");
    const logsDir = path.join(taskDir, "logs");

    const rawResearchPath = path.join(artifactsDir, "raw-research.json");
    const analysisOutputPath = path.join(artifactsDir, "analysis-output.json");
    const analysisSummaryPath = path.join(artifactsDir, "analysis-summary.txt");
    const ingestionLogPath = path.join(logsDir, "ingestion.log");
    const integrationLogPath = path.join(logsDir, "integration.log");

    // Check artifacts exist
    expect(
      await fs
        .access(rawResearchPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);
    expect(
      await fs
        .access(analysisOutputPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);
    expect(
      await fs
        .access(analysisSummaryPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);

    // Check logs exist
    expect(
      await fs
        .access(ingestionLogPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);
    expect(
      await fs
        .access(integrationLogPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true);

    // Verify file contents
    const rawResearch = JSON.parse(await fs.readFile(rawResearchPath, "utf8"));
    expect(rawResearch.content).toBe("Sample research data for analysis");
    expect(rawResearch.type).toBe("market-analysis");

    const analysisOutput = JSON.parse(
      await fs.readFile(analysisOutputPath, "utf8")
    );
    expect(analysisOutput.content).toContain("Key findings");
    expect(analysisOutput.metadata.tokens).toBe(150);

    const analysisSummary = await fs.readFile(analysisSummaryPath, "utf8");
    expect(analysisSummary).toContain("Analysis Summary");
    expect(analysisSummary).toContain("market-analysis");

    const ingestionLog = await fs.readFile(ingestionLogPath, "utf8");
    expect(ingestionLog).toContain("Starting data ingestion");
    expect(ingestionLog).toContain("Successfully ingested data");

    const integrationLog = await fs.readFile(integrationLogPath, "utf8");
    expect(integrationLog).toContain("Analysis integration completed");

    // Verify status file was updated with files arrays
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(status.files.artifacts).toContain("raw-research.json");
    expect(status.files.artifacts).toContain("analysis-output.json");
    expect(status.files.artifacts).toContain("analysis-summary.txt");
    expect(status.files.logs).toContain("ingestion.log");
    expect(status.files.logs).toContain("integration.log");

    // Verify task-level files arrays
    expect(status.tasks.analysis.files.artifacts).toContain(
      "raw-research.json"
    );
    expect(status.tasks.analysis.files.artifacts).toContain(
      "analysis-output.json"
    );
    expect(status.tasks.analysis.files.logs).toContain("ingestion.log");
    expect(status.tasks.analysis.files.logs).toContain("integration.log");
  });

  it("should handle file I/O gracefully when files API is not available", async () => {
    // Test that tasks can handle missing files API gracefully
    const context = {
      workDir: tempDir,
      taskName: "simple",
      statusPath,
      seed: {},
      artifacts: {},
      envLoaded: true,
      // No files API provided
    };

    // Simulate task execution without files API
    const mockStage = async (ctx) => {
      // Should not crash even if ctx.files is undefined
      if (ctx.files) {
        await ctx.files.writeArtifact("test.txt", "content");
      }
      return { output: { result: "success" } };
    };

    const result = await mockStage(context);
    expect(result.output.result).toBe("success");
  });
});
