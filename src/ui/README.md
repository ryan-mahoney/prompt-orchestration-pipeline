# Pipeline Orchestrator UI Server

A development tool that watches pipeline files and provides a live-updating web UI showing file changes in real-time.

## Quick Start

```bash
# Install dependencies
bun install

# Start the UI server with Bun watch mode
PO_ROOT=demo bun run ui

# Or start without auto-restart
PO_ROOT=demo bun run ui:prod
```

Open your browser to http://localhost:4000

Both `ui` and `ui:prod` require `PO_ROOT` to point at a pipeline root when run directly.

## Environment Variables

- `PO_ROOT` - Pipeline root to serve and watch (required for non-test runs)
- `PORT` - Server port (default: 4000)
- `WATCHED_PATHS` - Comma-separated directories to watch (default: "pipeline-config,runs")

### Examples

```bash
# Use a different port
PO_ROOT=demo PORT=3000 bun run ui

# Watch different directories
PO_ROOT=demo WATCHED_PATHS="pipeline-config,pipeline-data,demo" bun run ui

# Combine both
PO_ROOT=demo PORT=3000 WATCHED_PATHS="pipeline-config,demo" bun run ui
```

## Architecture

- **Single server process** - Bun runs the HTTP server and API endpoints
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

- Bun 1.1+
- Dependencies:
  - chokidar (file watching)
  - yaml (YAML file parsing)
  - commander (CLI argument parsing)
- Dev dependencies:
  - Bun watch mode for auto-restart during development
