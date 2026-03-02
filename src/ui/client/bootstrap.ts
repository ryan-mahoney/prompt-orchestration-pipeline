import type { BootstrapOptions, SseEventType } from "./types";

const DEFAULT_STATE_URL = "/api/state";
const DEFAULT_SSE_URL = "/api/events";
const BOOTSTRAP_EVENTS: SseEventType[] = [
  "state",
  "job:updated",
  "job:created",
  "job:removed",
  "heartbeat",
  "message",
];

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function loadSnapshot(stateUrl: string): Promise<unknown> {
  try {
    const response = await fetch(stateUrl);
    return await parseJson(response);
  } catch {
    return null;
  }
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<EventSource | null> {
  const stateUrl = options.stateUrl ?? DEFAULT_STATE_URL;
  const sseUrl = options.sseUrl ?? DEFAULT_SSE_URL;
  const applySnapshot = options.applySnapshot ?? (() => undefined);
  const onSseEvent = options.onSseEvent ?? (() => undefined);

  const snapshot = await loadSnapshot(stateUrl);
  await applySnapshot(snapshot);

  try {
    const source = new EventSource(sseUrl);
    for (const eventName of BOOTSTRAP_EVENTS) {
      source.addEventListener(eventName, (event) => {
        const message = event as MessageEvent<string>;
        try {
          onSseEvent(eventName, JSON.parse(message.data));
        } catch {
          onSseEvent(eventName, message.data);
        }
      });
    }
    return source;
  } catch {
    return null;
  }
}
