import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
import type { TaskFileIO } from "./file-io.ts";

function gitSync(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

async function captureDiff(io: TaskFileIO, cwd: string): Promise<boolean> {
  const repoCheck = gitSync(["rev-parse", "--is-inside-work-tree"], cwd);
  if (repoCheck.exitCode !== 0) return false;

  const indexPath = `/tmp/pop-index-${randomUUID()}`;
  try {
    const headCheck = gitSync(["rev-parse", "--verify", "HEAD"], cwd);
    const hasHead = headCheck.exitCode === 0;

    const env = { ...process.env, GIT_INDEX_FILE: indexPath };
    const indexOpts = { cwd, env, stdout: "pipe" as const, stderr: "pipe" as const };

    if (hasHead) {
      const rt = Bun.spawnSync(["git", "read-tree", "HEAD"], indexOpts);
      if (rt.exitCode !== 0) return false;
    } else {
      const rt = Bun.spawnSync(["git", "read-tree", "--empty"], indexOpts);
      if (rt.exitCode !== 0) return false;
    }

    const addResult = Bun.spawnSync(["git", "add", "-A"], indexOpts);
    if (addResult.exitCode !== 0) return false;

    const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--binary"], indexOpts);
    if (diffResult.exitCode !== 0) return false;

    const diff = diffResult.stdout.toString();
    if (diff.length > 0) {
      await io.writeArtifact("agent.patch", diff);
      return true;
    }
    return false;
  } finally {
    if (existsSync(indexPath)) {
      Bun.spawnSync(["rm", "-f", indexPath]);
    }
  }
}

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
  // The harness spawns with this cwd before any artifact is written, so the task
  // dir may not exist yet — posix_spawn ENOENTs on a missing working directory.
  await mkdir(cwd, { recursive: true });

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

    let patchWritten = false;
    if (args.entry.captureDiff) {
      patchWritten = await captureDiff(io, cwd);
    }

    const mcpArtifacts = mcpHandle?.artifactsWritten() ?? [];
    const allArtifacts = [
      ...new Set([...mcpArtifacts, "agent-result.md", ...(patchWritten ? ["agent.patch"] : [])]),
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
