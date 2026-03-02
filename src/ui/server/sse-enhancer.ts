import { transformJobListForAPI } from "../state/transformers/list-transformer";
import { transformJobStatus } from "../state/transformers/status-transformer";
import { Constants } from "./config-bridge-node";
import { readJob, type JobReadResult } from "./job-reader";
import { sseRegistry, type SSERegistry } from "./sse-registry";

export interface SSEEnhancerOptions {
  readJobFn: (jobId: string) => Promise<JobReadResult>;
  sseRegistry: SSERegistry;
  debounceMs?: number;
}

export interface SSEEnhancer {
  handleJobChange(change: { jobId: string; category?: string; filePath?: string }): void;
  getPendingCount(): number;
  cleanup(): void;
}

export function createSSEEnhancer(options: SSEEnhancerOptions): SSEEnhancer {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const seen = new Set<string>();
  const debounceMs = options.debounceMs ?? Constants.SSE_CONFIG.DEBOUNCE_MS;

  const flush = async (jobId: string): Promise<void> => {
    pending.delete(jobId);
    const result = await options.readJobFn(jobId);
    if (!result.ok) return;

    const transformed = transformJobStatus(result.data, jobId, result.location);
    if (!transformed) return;
    const [apiJob] = transformJobListForAPI([transformed], { includePipelineMetadata: true });
    options.sseRegistry.broadcast(seen.has(jobId) ? "job:updated" : "job:created", apiJob);
    seen.add(jobId);
  };

  return {
    handleJobChange(change) {
      const existing = pending.get(change.jobId);
      if (existing) clearTimeout(existing);
      pending.set(
        change.jobId,
        setTimeout(() => {
          void flush(change.jobId);
        }, debounceMs),
      );
    },
    getPendingCount() {
      return pending.size;
    },
    cleanup() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

export const sseEnhancer = createSSEEnhancer({ readJobFn: readJob, sseRegistry });

export function routeJobChange(change: { jobId: string; category?: string; filePath?: string }): void {
  sseEnhancer.handleJobChange(change);
}
