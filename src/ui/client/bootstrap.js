/**
 * Client bootstrap helper
 *
 * Usage:
 *   await bootstrap({
 *     stateUrl = '/api/state',
 *     sseUrl = '/api/events',
 *     applySnapshot: async (snapshot) => { ... },
 *     onSseEvent: (type, data) => { ... }
 *   })
 *
 * Semantics:
 *  - Fetches stateUrl and awaits applySnapshot(snapshot)
 *  - Only after applySnapshot resolves, creates EventSource(sseUrl)
 *  - Attaches listeners for common event types and forwards them to onSseEvent
 *  - Returns the created EventSource instance (or null on failure)
 */
export async function bootstrap({
  stateUrl = "/api/state",
  sseUrl = "/api/events",
  applySnapshot = async () => {},
  onSseEvent = () => {},
} = {}) {
  const controller = new AbortController();
  try {
    const res = await fetch(stateUrl, { signal: controller.signal });
    if (res && res.ok) {
      const json = await res.json();
      // Allow applySnapshot to be async and await it
      await applySnapshot(json);
    } else {
      // Try to parse body when available, but still call applySnapshot with whatever we get
      let body = null;
      if (res) {
        try {
          body = await res.json();
        } catch (jsonErr) {
          const contentType = res.headers.get("content-type");
          console.error(
            `[bootstrap] Failed to parse JSON from ${stateUrl}: status=${res.status}, content-type=${contentType}, error=${jsonErr}`
          );
          body = null;
        }
      }
      await applySnapshot(body);
    }
  } catch (err) {
    // Best-effort: still call applySnapshot with null so callers can handle startup failure
    try {
      await applySnapshot(null);
    } catch (e) {
      // ignore
    }
  }

  // Create EventSource after snapshot applied
  let es = null;
  try {
    es = new EventSource(sseUrl);

    // Forward 'state' events (server may send full state on connect in current implementation)
    es.addEventListener("state", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("state", data);
      } catch (err) {
        // ignore parse errors
      }
    });

    // Forward job-specific events
    es.addEventListener("job:updated", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("job:updated", data);
      } catch (err) {
        // ignore parse errors
      }
    });

    es.addEventListener("job:created", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("job:created", data);
      } catch (err) {}
    });

    es.addEventListener("job:removed", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("job:removed", data);
      } catch (err) {}
    });

    es.addEventListener("heartbeat", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("heartbeat", data);
      } catch (err) {}
    });

    // Generic message handler as fallback
    es.addEventListener("message", (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onSseEvent("message", data);
      } catch (err) {}
    });
  } catch (err) {
    // If EventSource creation fails, return null
    try {
      if (es && typeof es.close === "function") es.close();
    } catch {}
    return null;
  }

  return es;
}

export default bootstrap;
