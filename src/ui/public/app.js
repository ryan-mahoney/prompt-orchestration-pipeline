/**
 * Frontend application for Pipeline Orchestrator UI
 * Handles SSE connection, state updates, and UI rendering
 */

// DOM elements
const elements = {
  changeCount: document.getElementById("changeCount"),
  updatedAt: document.getElementById("updatedAt"),
  changesList: document.getElementById("changesList"),
  watchedPaths: document.getElementById("watchedPaths"),
  connectionStatus: document.getElementById("connectionStatus"),
};

// Connection state
let eventSource = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return "Never";

  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  if (diffHour === 1) return "1 hour ago";
  if (diffHour < 24) return `${diffHour} hours ago`;
  if (diffDay === 1) return "1 day ago";
  return `${diffDay} days ago`;
}

/**
 * Format absolute timestamp
 */
function formatAbsoluteTime(timestamp) {
  if (!timestamp) return "Never";
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
  const statusDot = elements.connectionStatus.querySelector(".status-dot");
  const statusText = elements.connectionStatus.querySelector(".status-text");

  statusDot.className = "status-dot";

  switch (status) {
    case "connected":
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
      break;
    case "reconnecting":
      statusDot.classList.add("reconnecting");
      statusText.textContent = "Reconnecting...";
      break;
    case "disconnected":
      statusDot.classList.add("disconnected");
      statusText.textContent = "Disconnected";
      break;
    default:
      statusText.textContent = "Connecting...";
  }
}

/**
 * Render the UI with current state
 */
function renderState(state) {
  // Update change count
  elements.changeCount.textContent = state.changeCount || 0;

  // Update last updated time
  elements.updatedAt.textContent = formatRelativeTime(state.updatedAt);
  elements.updatedAt.title = formatAbsoluteTime(state.updatedAt);

  // Update watched paths
  if (state.watchedPaths && state.watchedPaths.length > 0) {
    const pathsSpan = elements.watchedPaths.querySelector(".paths");
    pathsSpan.textContent = state.watchedPaths.join(", ");
  }

  // Render recent changes
  if (state.recentChanges && state.recentChanges.length > 0) {
    elements.changesList.innerHTML = state.recentChanges
      .map((change) => {
        const typeClass = `change-type-${change.type}`;
        const typeLabel =
          change.type.charAt(0).toUpperCase() + change.type.slice(1);
        const relativeTime = formatRelativeTime(change.timestamp);
        const absoluteTime = formatAbsoluteTime(change.timestamp);

        return `
          <div class="change-item">
            <div class="change-header">
              <span class="change-type ${typeClass}">${typeLabel}</span>
              <span class="change-time" title="${absoluteTime}">${relativeTime}</span>
            </div>
            <div class="change-path">${escapeHtml(change.path)}</div>
          </div>
        `;
      })
      .join("");
  } else {
    elements.changesList.innerHTML =
      '<div class="empty-state">No changes yet. Modify files in watched directories to see updates.</div>';
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Fetch initial state from API
 */
async function fetchInitialState() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Failed to fetch state");
    const state = await response.json();
    renderState(state);
  } catch (error) {
    console.error("Error fetching initial state:", error);
  }
}

/**
 * Connect to SSE endpoint
 */
function connectSSE() {
  // Clean up existing connection
  if (eventSource) {
    eventSource.close();
  }

  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  updateConnectionStatus("connecting");

  // Create new EventSource
  eventSource = new EventSource("/api/events");

  // Handle state updates
  eventSource.addEventListener("state", (event) => {
    try {
      const state = JSON.parse(event.data);
      renderState(state);
      updateConnectionStatus("connected");
    } catch (error) {
      console.error("Error parsing state event:", error);
    }
  });

  // Handle connection open
  eventSource.addEventListener("open", () => {
    console.log("SSE connection established");
    updateConnectionStatus("connected");
  });

  // Handle errors
  eventSource.addEventListener("error", (error) => {
    console.error("SSE connection error:", error);

    if (eventSource.readyState === EventSource.CLOSED) {
      updateConnectionStatus("disconnected");
      scheduleReconnect();
    } else {
      updateConnectionStatus("reconnecting");
    }
  });
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect() {
  if (reconnectTimer) return;

  updateConnectionStatus("reconnecting");

  reconnectTimer = setTimeout(() => {
    console.log("Attempting to reconnect...");
    connectSSE();
  }, RECONNECT_DELAY);
}

/**
 * Initialize the application
 */
async function init() {
  console.log("Initializing Pipeline Orchestrator UI...");

  // Fetch initial state
  await fetchInitialState();

  // Connect to SSE
  connectSSE();

  // Update relative times every 10 seconds
  setInterval(() => {
    const updatedAt = elements.updatedAt.textContent;
    if (updatedAt !== "Never") {
      const timestamp = elements.updatedAt.title;
      if (timestamp) {
        elements.updatedAt.textContent = formatRelativeTime(
          new Date(timestamp)
        );
      }
    }

    // Update change times
    document.querySelectorAll(".change-time").forEach((el) => {
      const absoluteTime = el.title;
      if (absoluteTime) {
        el.textContent = formatRelativeTime(new Date(absoluteTime));
      }
    });
  }, 10000);
}

// Start the application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  if (eventSource) {
    eventSource.close();
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
});
