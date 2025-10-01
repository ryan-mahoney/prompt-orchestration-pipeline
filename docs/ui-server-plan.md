# Pipeline Orchestrator UI - Simplified Dev-Only Plan

## Overview

A single-server development tool that watches pipeline files and provides a live-updating web UI showing file changes. Optimized for simplicity and quick implementation.

## Core Principles

- **Single server, single process** - One Node.js server handles everything
- **Minimal dependencies** - Node built-ins + chokidar + minimal frontend
- **Dev-only focus** - No production build complexity
- **Simple state** - Just track what changed and when

## Stack

- Node 20+ (built-in `http`, `fs`, `path`, `url`)
- **chokidar** for file watching
- **Plain HTML/CSS/JS** for UI (no build step)
- **Server-Sent Events (SSE)** for live updates

## File Structure

```
pipeline-orchestrator/
├── src/ui
│       ├── server.js        # Main server: static files, API, SSE
│       ├── watcher.js       # File watcher with debouncing
│       ├── state.js         # State management and diffing
│       └── public/
│           ├── index.html   # UI HTML
│           ├── app.js       # Frontend JavaScript
│           └── style.css    # Tailwind or simple CSS
├── package.json
└── README.md
```

## Data Contract

### State Schema

```json
{
  "updatedAt": "2024-01-10T10:30:00Z",
  "changeCount": 42,
  "recentChanges": [
    {
      "path": "pipeline-config/demo/config.yaml",
      "type": "modified",
      "timestamp": "2024-01-10T10:30:00Z"
    }
  ],
  "watchedPaths": ["pipeline-config", "runs"]
}
```

- `changeCount`: Total changes since server start
- `recentChanges`: Last 10 changes (FIFO)
- `watchedPaths`: Directories being monitored

---

## Implementation Milestones

### Milestone 1: State Manager

**File:** `src/ui/state.js`

Create a simple state manager that tracks changes.

**Exports:**

```javascript
{
  getState: () => state,
  recordChange: (path, type) => updatedState,
  reset: () => void
}
```

**Prompt for Claude:**

> Create `src/ui/state.js` that manages an in-memory state object. It should track `changeCount`, `updatedAt`, and maintain a list of the last 10 changes in `recentChanges`. Each change has path, type (created/modified/deleted), and timestamp. Export functions to get current state, record a change, and reset state. Keep it simple - under 50 lines.

---

### Milestone 2: File Watcher

**File:** `src/ui/watcher.js`

Wrapper around chokidar with debouncing.

**Exports:**

```javascript
{
  start: (paths, onChange) => watcher,
  stop: (watcher) => void
}
```

**Prompt for Claude:**

> Create `src/ui/watcher.js` using chokidar. Export a `start(paths, onChange)` function that watches the given paths and calls `onChange(path, type)` for each change. Include 200ms debouncing so rapid changes are batched. Types are 'created', 'modified', or 'deleted'. Ignore node_modules and .git. Keep it under 40 lines.

---

### Milestone 3: HTTP Server with SSE

**File:** `src/ui/server.js`

Single Node.js server handling everything.

**Routes:**

- `GET /` → serve index.html
- `GET /app.js` → serve app.js
- `GET /style.css` → serve style.css
- `GET /api/state` → return current state as JSON
- `GET /api/events` → SSE endpoint for live updates

**Prompt for Claude:**

> Create `src/ui/server.js` using Node's built-in `http` module. It should:
>
> 1. Serve static files from `src/ui/public/` for `/`, `/app.js`, `/style.css`
> 2. Provide `/api/state` endpoint returning JSON from state.js
> 3. Provide `/api/events` SSE endpoint that sends initial state and updates
> 4. Initialize the file watcher on startup for paths from WATCHED_PATHS env var (default: "pipeline-config,runs")
> 5. When files change, update state and broadcast to all SSE clients
> 6. Send SSE heartbeat every 30 seconds
> 7. Port from PORT env var (default: 4000)
>    Keep it under 150 lines. Use proper SSE format with "event: state\ndata: {json}\n\n".

---

### Milestone 4: Frontend UI

**Files:** `src/ui/public/index.html`, `src/ui/public/app.js`, `src/ui/public/style.css`

Simple, responsive UI that shows state and updates live.

**Prompt for Claude:**

> Create a simple web UI in `src/ui/public/`:
>
> **index.html**:
>
> - Modern, clean layout
> - Display area for changeCount (large number)
> - Display area for updatedAt (formatted timestamp)
> - List of recent changes (path, type, relative time)
> - Connection status indicator
>
> **app.js**:
>
> - Fetch initial state from `/api/state`
> - Connect to `/api/events` using EventSource
> - Update UI when receiving events
> - Auto-reconnect on connection loss
> - Format timestamps as relative time ("2 minutes ago")
> - Show connection status (connected/reconnecting)
>
> **style.css**:
>
> - Simple, modern styles (can use Tailwind from CDN)
> - Dark mode friendly
> - Responsive layout
> - Subtle animations for updates
>
> Keep it simple but polished. No build tools needed.

---

### Milestone 5: Package Setup & Scripts

**File:** `package.json`

**Prompt for Claude:**

> Create `package.json` with:
>
> - Dependencies: chokidar (only)
> - Scripts:
>   - `start`: runs server.js with nodemon for auto-restart
>   - `start:prod`: runs server.js directly
> - Require Node 20+
> - Include basic metadata

---

### Milestone 6: Documentation

**File:** `README.md`

**Prompt for Claude:**

> Create a README.md that explains:
>
> - What this tool does (1-2 sentences)
> - How to install and run it
> - Environment variables (WATCHED_PATHS, PORT)
> - How to customize watched directories
> - Basic architecture (single server, SSE updates)
>   Keep it under 100 lines, focused on practical usage.

---

## Testing Plan

### Manual Testing Checklist

1. **Start server:** `npm start`
2. **Open browser:** http://localhost:4000
3. **Verify initial state:** Should show 0 changes
4. **Create a file** in `pipeline-config/`: Count should increment
5. **Modify the file:** Should see update in recent changes
6. **Delete the file:** Should register as deleted
7. **Kill and restart server:** UI should reconnect automatically
8. **Make rapid changes:** Should debounce and batch properly

### Optional: Simple Integration Test

**Prompt for Claude:**

> Create `test.js` that:
>
> 1. Starts the server on a random port
> 2. Makes an HTTP request to `/api/state`
> 3. Connects to `/api/events`
> 4. Simulates a file change by calling state.recordChange
> 5. Verifies the SSE event is received
> 6. Cleans up and exits
>    Use only Node built-ins, no test framework. Keep under 100 lines.

---

## Success Criteria

- [x] Single `npm start` command launches everything
- [x] UI updates within 500ms of file changes
- [x] Shows change count and last updated time
- [x] Lists recent changes with paths
- [x] Auto-reconnects if server restarts
- [x] No build step required
- [x] Under 500 total lines of code

---

## Implementation Order

1. State manager (state.js)
2. File watcher (watcher.js)
3. Server with API + SSE (server.js)
4. Frontend UI (public/\*)
5. Package.json and README
6. Manual testing
