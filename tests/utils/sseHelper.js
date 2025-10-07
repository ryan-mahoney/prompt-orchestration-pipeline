/**
 * Helper utilities for testing Server-Sent Events
 */

/**
 * Connect to an SSE endpoint and collect events
 * @param {string} url - SSE endpoint URL
 * @param {string} eventType - Event type to listen for
 * @param {Object} options - Options
 * @param {number} options.timeout - Max wait time in ms (default: 5000)
 * @returns {Promise<{events: Array, eventSource: EventSource, close: Function}>}
 */
export async function connectSSE(url, eventType, options = {}) {
  const { timeout = 5000 } = options;
  const { EventSource } = await import("./env.js");

  const events = [];
  const eventSource = new EventSource(url);

  // Wait for connection to open
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSE connection timeout after ${timeout}ms`));
    }, timeout);

    eventSource.onopen = () => {
      clearTimeout(timer);
      resolve();
    };

    eventSource.onerror = (error) => {
      clearTimeout(timer);
      reject(new Error("SSE connection failed"));
    };
  });

  // Set up event listener
  eventSource.addEventListener(eventType, (event) => {
    events.push(JSON.parse(event.data));
  });

  return {
    events,
    eventSource,
    close: () => eventSource.close(),
  };
}

/**
 * Wait for at least one event to be received
 * @param {Array} eventsArray - Array to monitor
 * @param {number} timeout - Max wait time in ms (default: 3000)
 * @returns {Promise<void>}
 */
export function waitForEvent(eventsArray, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      if (eventsArray.length > 0) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`No events received within ${timeout}ms`));
      }
    }, 50);
  });
}
