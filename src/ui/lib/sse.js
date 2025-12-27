export function streamSSE(res) {
  console.log("[sse] Creating new SSE stream");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  console.log("[sse] SSE headers set and flushed");

  return {
    send(event, data) {
      console.log("[sse] Sending event:", {
        eventType: event,
        hasData: !!data,
        dataKeys: data ? Object.keys(data) : [],
      });

      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(eventData);

      console.log("[sse] Event sent successfully");
    },
    end() {
      console.log("[sse] Ending SSE stream");
      res.end();
      console.log("[sse] SSE stream ended");
    },
  };
}
