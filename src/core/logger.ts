// src/core/logger.ts

export interface LogContext {
  jobId?: string;
  taskName?: string;
  stage?: string;
  [key: string]: string | undefined;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  log(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  group(label: string, data?: unknown): void;
  groupEnd(): void;
  sse(eventType: string, eventData: unknown): void;
}

// Lazy SSE registry cache
let sseRegistry: { broadcast: (eventType: string, data: unknown) => void } | null = null;

async function getSSERegistry(): Promise<{ broadcast: (eventType: string, data: unknown) => void } | null> {
  if (sseRegistry !== null) return sseRegistry;
  try {
    // Dynamic import path kept as a variable to avoid static resolution errors
    // when the module does not yet exist. Fails gracefully at runtime.
    const ssePath = "../ui/sse.ts";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* @vite-ignore */ ssePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    sseRegistry = mod as { broadcast: (eventType: string, data: unknown) => void };
    return sseRegistry;
  } catch {
    return null;
  }
}

function formatPrefix(componentName: string, context?: LogContext): string {
  const parts: string[] = [componentName];
  if (context?.jobId) parts.push(context.jobId);
  if (context?.taskName) parts.push(context.taskName);
  if (context?.stage) parts.push(context.stage);
  return `[${parts.join("|")}]`;
}

export function createLogger(componentName: string, context?: LogContext): Logger {
  const prefix = formatPrefix(componentName, context);

  function formatData(data: unknown): Record<string, unknown> {
    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack,
        component: componentName,
        timestamp: new Date().toISOString(),
        ...context,
      };
    }
    try {
      JSON.stringify(data);
      return data as Record<string, unknown>;
    } catch {
      return { serialization_error: String(data) };
    }
  }

  function stringify(data: unknown): string {
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  return {
    debug(message, data) {
      if (process.env["NODE_ENV"] === "production" && !process.env["DEBUG"]) return;
      if (data !== undefined) {
        console.debug(prefix, message, stringify(data));
      } else {
        console.debug(prefix, message);
      }
    },

    log(message, data) {
      if (data !== undefined) {
        console.log(prefix, message, stringify(data));
      } else {
        console.log(prefix, message);
      }
    },

    warn(message, data) {
      if (data !== undefined) {
        console.warn(prefix, message, stringify(data));
      } else {
        console.warn(prefix, message);
      }
    },

    error(message, data) {
      const enriched = data !== undefined ? formatData(data) : undefined;
      if (enriched !== undefined) {
        console.error(prefix, message, stringify(enriched));
      } else {
        console.error(prefix, message);
      }
    },

    group(label, data) {
      if (data !== undefined) {
        console.group(prefix, label, stringify(data));
      } else {
        console.group(prefix, label);
      }
    },

    groupEnd() {
      console.groupEnd();
    },

    sse(eventType, eventData) {
      console.log(prefix, `[SSE:${eventType}]`, stringify(eventData));
      void getSSERegistry().then((registry) => {
        if (!registry) return;
        try {
          registry.broadcast(eventType, formatData(eventData));
        } catch (err) {
          console.warn(prefix, "SSE broadcast failed", err);
        }
      }).catch((err) => {
        console.warn(prefix, "SSE registry unavailable", err);
      });
    },
  };
}

export function createJobLogger(
  componentName: string,
  jobId: string,
  additionalContext?: LogContext
): Logger {
  return createLogger(componentName, { ...additionalContext, jobId });
}

export function createTaskLogger(
  componentName: string,
  jobId: string,
  taskName: string,
  additionalContext?: LogContext
): Logger {
  return createLogger(componentName, { ...additionalContext, jobId, taskName });
}
