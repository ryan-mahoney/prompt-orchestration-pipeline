import { createTaskFileIO, generateLogName } from "./file-io.ts";
import { LogEvent, LogFileExtension } from "../config/log-events.ts";
import { runHarnessTask } from "../harness/executor.ts";
import { startMcpIoServer } from "../harness/mcp-io-server.ts";
import type { McpIoServerHandle } from "../harness/mcp-io-server.ts";
import type {
  AgentEntryConfig,
  AgentStepResult,
  HarnessEvent,
} from "../harness/types.ts";

export async function runAgentStep(
  args: {
    entry: AgentEntryConfig & { name: string };
    workDir: string;
    statusPath: string;
    jobId: string | undefined;
    getStage: () => string;
  },
  deps?: {
    runHarnessTask?: typeof runHarnessTask;
    startMcpIoServer?: typeof startMcpIoServer;
    createTaskFileIO?: typeof createTaskFileIO;
  },
): Promise<AgentStepResult> {
  const _runHarnessTask = deps?.runHarnessTask ?? runHarnessTask;
  const _startMcpIoServer = deps?.startMcpIoServer ?? startMcpIoServer;
  const _createTaskFileIO = deps?.createTaskFileIO ?? createTaskFileIO;

  const io = _createTaskFileIO({
    workDir: args.workDir,
    taskName: args.entry.name,
    getStage: args.getStage,
    statusPath: args.statusPath,
  });

  const cwd = args.entry.cwd ?? io.getTaskDir();

  let prompt: string;
  if (args.entry.prompt !== undefined) {
    prompt = args.entry.prompt;
  } else if (args.entry.promptFrom !== undefined) {
    prompt = await io.readArtifact(args.entry.promptFrom);
  } else {
    throw new Error(
      `Agent entry "${args.entry.name}" must specify either "prompt" or "promptFrom"`,
    );
  }

  let mcpHandle: McpIoServerHandle | undefined;
  if (args.entry.io !== false) {
    mcpHandle = await _startMcpIoServer(io);
  }

  try {
    const logName = generateLogName(
      args.entry.name,
      "agent",
      LogEvent.DEBUG,
      LogFileExtension.TEXT,
    );

    const result = await _runHarnessTask({
      harness: args.entry.harness,
      prompt,
      cwd,
      model: args.entry.model,
      mcp: mcpHandle?.connection,
      timeoutMs: args.entry.timeoutMs,
      onEvent: (event: HarnessEvent) => {
        void io.writeLog(logName, JSON.stringify(event.raw) + "\n", {
          mode: "append",
        });
      },
    });

    await io.writeArtifact("agent-result.md", result.finalMessage);

    const mcpArtifacts = mcpHandle?.artifactsWritten() ?? [];
    const allArtifacts = [
      ...new Set([...mcpArtifacts, "agent-result.md"]),
    ];

    return {
      ok: true,
      finalMessage: result.finalMessage,
      artifactsWritten: allArtifacts,
      usage: result.usage,
      costUsd: result.costUsd,
      sessionId: result.sessionId,
    };
  } catch (err) {
    const mcpArtifacts = mcpHandle?.artifactsWritten() ?? [];
    const allArtifacts = [
      ...new Set([...mcpArtifacts, "agent-result.md"]),
    ];

    return {
      ok: false,
      finalMessage: "",
      artifactsWritten: allArtifacts,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (mcpHandle) {
      await mcpHandle.close();
    }
  }
}
