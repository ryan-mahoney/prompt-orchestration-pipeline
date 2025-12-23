export function streamSSE(res) {
  let active = true;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Mark connection inactive when the client disconnects or an error occurs
  res.on("close", () => {
    active = false;
  });

  res.on("error", () => {
    if (!active) {
      return;
    }
    active = false;
    try {
      res.end();
    } catch {
      // ignore further errors on close
    }
  });

  return {
    send(event, data) {
      if (!active) {
        return false;
      }
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch {
        active = false;
        try {
          res.end();
        } catch {
          // ignore further errors on close
        }
        return false;
      }
    },
    end() {
      if (!active) {
        return;
      }
      active = false;
      try {
        res.end();
      } catch {
        // ignore errors when ending the response
      }
    },
    isActive() {
      return active;
    },
  };
}
