const encoder = new TextEncoder();

export interface SSEClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  jobId?: string;
  signal: AbortSignal;
}

export interface SSERegistryOptions {
  heartbeatMs?: number;
  sendInitialPing?: boolean;
}

export interface SSEEvent {
  type: string;
  data: unknown;
}

export interface SSERegistry {
  addClient(
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal,
    metadata?: { jobId?: string },
  ): void;
  removeClient(
    controller: ReadableStreamDefaultController<Uint8Array>,
    options?: { closeStream?: boolean },
  ): void;
  broadcast(event: SSEEvent): void;
  broadcast(type: string, data: unknown): void;
  broadcast(data: unknown): void;
  getClientCount(): number;
  closeAll(): void;
}

function frame(type: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function getEvent(arg1: SSEEvent | string | unknown, arg2?: unknown): SSEEvent {
  if (typeof arg1 === "string") return { type: arg1, data: arg2 };
  if (typeof arg1 === "object" && arg1 !== null && "type" in arg1 && "data" in arg1) {
    return arg1 as SSEEvent;
  }
  return { type: "message", data: arg1 };
}

function getJobId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const jobId = (data as Record<string, unknown>)["jobId"];
  return typeof jobId === "string" ? jobId : undefined;
}

export function createSSERegistry(options: SSERegistryOptions = {}): SSERegistry {
  const clients = new Set<SSEClient>();
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const initialPing = options.sendInitialPing ?? false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const removeClient = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    options?: { closeStream?: boolean },
  ): void => {
    for (const client of clients) {
      if (client.controller !== controller) continue;
      clients.delete(client);
      if (options?.closeStream) {
        try {
          client.controller.close();
        } catch {}
      }
      break;
    }
    if (clients.size === 0) stopHeartbeat();
  };

  const broadcastImpl = (event: SSEEvent): void => {
    const payload = frame(event.type, event.data);
    const jobId = getJobId(event.data);

    for (const client of [...clients]) {
      if (jobId && client.jobId && client.jobId !== jobId) continue;
      try {
        client.controller.enqueue(payload);
      } catch {
        removeClient(client.controller);
      }
    }
  };

  const startHeartbeat = (): void => {
    if (heartbeat || clients.size === 0) return;
    heartbeat = setInterval(() => {
      for (const client of [...clients]) {
        try {
          client.controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          removeClient(client.controller);
        }
      }
      if (clients.size === 0) stopHeartbeat();
    }, heartbeatMs);
  };

  return {
    addClient(controller, signal, metadata) {
      const client: SSEClient = { controller, signal, jobId: metadata?.jobId };
      clients.add(client);
      signal.addEventListener("abort", () => removeClient(controller), { once: true });
      if (initialPing) {
        try {
          controller.enqueue(encoder.encode(": connected\n\n"));
        } catch {
          removeClient(controller);
          return;
        }
      }
      startHeartbeat();
    },
    removeClient,
    broadcast(arg1: SSEEvent | string | unknown, arg2?: unknown) {
      broadcastImpl(getEvent(arg1, arg2));
    },
    getClientCount() {
      return clients.size;
    },
    closeAll() {
      for (const client of [...clients]) {
        removeClient(client.controller, { closeStream: true });
      }
      stopHeartbeat();
    },
  };
}

export const sseRegistry = createSSERegistry({ heartbeatMs: 8_000, sendInitialPing: true });
