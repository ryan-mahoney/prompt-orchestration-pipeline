# Pipeline Orchestrator UI Server

A development tool that watches pipeline files and provides a live-updating web UI showing file changes in real-time.

## Quick Start

```bash
# Install dependencies
npm install

# Start the UI server with auto-restart
npm run ui

# Or start without auto-restart
npm run ui:prod
```

Open your browser to http://localhost:4000

## Environment Variables

- `PORT` - Server port (default: 4000)
- `WATCHED_PATHS` - Comma-separated directories to watch (default: "pipeline-config,runs")

### Examples

```bash
# Use a different port
PORT=3000 npm run ui

# Watch different directories
WATCHED_PATHS="pipeline-config,pipeline-data,demo" npm run ui

# Combine both
PORT=3000 WATCHED_PATHS="pipeline-config,demo" npm run ui
```

## Architecture

- **Single server process** - Node.js HTTP server handles everything
- **File watching** - Chokidar monitors specified directories for changes
- **Live updates** - Server-Sent Events (SSE) push changes to browser
- **No build step** - Plain HTML/CSS/JS served directly

## API Endpoints

- `GET /` - Serve the UI (index.html)
- `GET /api/state` - Get current state as JSON
- `GET /api/events` - SSE endpoint for live updates

## State Schema

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

## Development

The UI server automatically:

- Watches configured directories for file changes
- Debounces rapid changes (200ms)
- Maintains last 10 changes in memory
- Broadcasts updates to all connected clients
- Sends heartbeat every 30 seconds to keep connections alive

## Requirements

- Node.js 20+
- Dependencies: chokidar (file watching)
- Dev dependencies: nodemon (auto-restart)
