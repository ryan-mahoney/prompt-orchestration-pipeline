import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Legacy Stage Integration Test", () => {
  it("should demonstrate legacy stage chaining works with real task-runner", async () => {
    // This test verifies the surgical changes work without complex mocking
    // We'll create a minimal test that exercises the legacy stage logic

    // Mock the module loader to return a simple test module
    const mockModuleLoader = vi.doMock("../src/core/module-loader.js", () => ({
      loadFreshModule: vi.fn().mockResolvedValue({
        default: {
          // Simple legacy stages for testing
          ingestion: (context) => {
            // Legacy stage - should read from context.data.seed
            expect(context.data.seed).toBeDefined();
            return "ingested-data";
          },
          promptTemplating: (context) => {
            // Should have context.output from previous stage
            expect(context.output).toBe("ingested-data");
            return "templated-data";
          },
          parsing: (context) => {
            // Should have context.output from promptTemplating
            expect(context.output).toBe("templated-data");
            return "parsed-data";
          },
        },
      }),
    }));

    // Mock other dependencies minimally
    vi.doMock("../src/core/environment.js", () => ({
      loadEnvironment: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("../src/llm/index.js", () => ({
      createLLM: vi.fn().mockReturnValue({
        openai: { chat: vi.fn() },
      }),
      getLLMEvents: vi.fn().mockReturnValue({
        on: vi.fn(),
        off: vi.fn(),
      }),
    }));

    vi.doMock("../src/core/config.js", () => ({
      getConfig: vi.fn().mockReturnValue({}),
    }));

    vi.doMock("../src/core/file-io.js", () => ({
      createTaskFileIO: vi.fn().mockReturnValue({
        readFile: vi.fn(),
        writeFile: vi.fn(),
        listFiles: vi.fn(),
      }),
    }));

    // Import after mocking
    const { runPipeline } = await import("../src/core/task-runner.js");

    const initialContext = {
      seed: { data: { test: "data" } },
      taskName: "test-task",
      workDir: "/tmp/test",
      statusPath: "/tmp/test/status.json",
      jobId: "test-job-123",
      envLoaded: true,
      llm: {
        openai: { chat: vi.fn() },
      },
    };

    const result = await runPipeline("/fake/path", initialContext);

    expect(result.ok).toBe(true);

    // Verify the legacy stages were executed and chained correctly
    expect(result.context.data.ingestion).toBe("ingested-data");
    expect(result.context.data.promptTemplating).toBe("templated-data");
    expect(result.context.data.parsing).toBe("parsed-data");

    // Cleanup
    mockModuleLoader.unmock();
  });
});
