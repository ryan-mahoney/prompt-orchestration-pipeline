import { createLogger } from "../../core/logger";
import { sseRegistry } from "./sse-registry";

interface ChangeLike {
  path: string;
  type: string;
  timestamp: string;
}

interface StateLike {
  recentChanges: ChangeLike[];
  changeCount: number;
}

const logger = createLogger("ui-server-sse-broadcast");

function parseChange(change: ChangeLike): ChangeLike & { jobId?: string; lifecycle?: string } {
  const match = /^pipeline-data\/(current|complete|pending|rejected)\/([^/]+)\//.exec(change.path);
  if (!match) return change;
  return { ...change, lifecycle: match[1], jobId: match[2] };
}

export function broadcastStateUpdate(currentState: StateLike): void {
  try {
    const prioritized = currentState.recentChanges.find((change) =>
      change.path.endsWith("/tasks-status.json"),
    );

    if (prioritized) {
      sseRegistry.broadcast("state:change", parseChange(prioritized));
      return;
    }

    sseRegistry.broadcast("state:summary", { changeCount: currentState.changeCount });
  } catch (error) {
    try {
      logger.error("failed to broadcast state update", error);
    } catch {}
  }
}
