# Pipeline Listing Feature Implementation Plan

## Overview

Add functionality to list available pipelines in the system through a backend API endpoint and frontend page with navigation integration.

## Prerequisites

### 1. Registry Field Consistency Fix

**Problem**: There's a mismatch between the current registry format and what `src/core/config.js` expects:

- Current registry uses `pipelinePath` and `taskRegistryPath`
- `config.js` `normalizeRegistryEntry()` function looks for `pipelineJsonPath` and ignores `taskRegistryPath`
- This creates inconsistency between registry data and processed configuration

**Fix Required**: Update `src/core/config.js` to handle both field formats for backward compatibility:

```javascript
function normalizeRegistryEntry(slug, entry, rootDir) {
  const pipelineJsonPath =
    entry?.pipelineJsonPath || entry?.pipelinePath
      ? resolveWithBase(rootDir, entry.pipelineJsonPath || entry.pipelinePath)
      : undefined;

  const configDir = entry?.configDir
    ? resolveWithBase(rootDir, entry.configDir)
    : pipelineJsonPath
      ? path.dirname(pipelineJsonPath)
      : path.join(rootDir, "pipeline-config", slug);

  const tasksDir = entry?.tasksDir
    ? resolveWithBase(rootDir, entry.tasksDir)
    : path.join(configDir, "tasks");

  return {
    configDir,
    tasksDir,
    name: entry?.name,
    description: entry?.description,
  };
}
```

This fix ensures the API can return consistent data while maintaining backward compatibility.

## Current Architecture Analysis

### Backend Structure

- API endpoints are organized in `src/ui/endpoints/` with modular handlers
- Express app routes are defined in `src/ui/express-app.js`
- Pipeline configuration is managed through `src/core/config.js` which reads from `demo/pipeline-config/registry.json`
- The registry contains pipeline metadata: slug, name, description, and file paths

### Frontend Structure

- React Router setup in `src/ui/client/main.jsx` with routes for `/`, `/pipeline/:jobId`, and `/code`
- Layout component in `src/components/Layout.jsx` with navigation header
- Pages are in `src/pages/` (Dashboard, PipelineDetail, Code)
- Uses Radix UI components and Tailwind CSS

### Registry Format (Current)

```json
{
  "pipelines": {
    "content-generation": {
      "name": "Content Generation Pipeline",
      "description": "Generates and processes content using LLM tasks",
      "pipelinePath": "demo/pipeline-config/content-generation/pipeline.json",
      "taskRegistryPath": "demo/pipeline-config/content-generation/tasks/index.js"
    }
  }
}
```

### Registry Format (After API Processing)

```json
{
  "pipelines": {
    "content-generation": {
      "name": "Content Generation Pipeline",
      "description": "Generates and processes content using LLM tasks",
      "configDir": "/absolute/path/to/demo/pipeline-config/content-generation",
      "tasksDir": "/absolute/path/to/demo/pipeline-config/content-generation/tasks"
    }
  }
}
```

## Implementation Plan

### 1. Backend API Endpoint

**File:** `src/ui/endpoints/pipelines-endpoint.js`

Create `GET /api/pipelines` endpoint that:

- Leverages existing `src/core/config.js` `loadConfig()` function
- Returns structured pipeline data with slug, name, description
- Follows existing error handling patterns from other endpoints
- Uses `sendJson` utility for consistent response formatting

**Error Handling & Empty States:**

- **Registry file not found**: Return 200 with empty pipelines array (not an error)
- **Invalid JSON format**: Return 500 with specific error message about malformed registry
- **Config system error**: Return 500 with configuration error details
- **No pipelines registered**: Return 200 with empty pipelines array

**Success Response Format:**

```json
{
  "ok": true,
  "data": {
    "pipelines": [
      {
        "slug": "content-generation",
        "name": "Content Generation Pipeline",
        "description": "Generates and processes content using LLM tasks"
      }
    ]
  }
}
```

**Empty State Response Format:**

```json
{
  "ok": true,
  "data": {
    "pipelines": []
  }
}
```

**Error Response Format:**

```json
{
  "ok": false,
  "error": "registry_invalid",
  "message": "Pipeline registry contains invalid JSON: Unexpected token } in JSON at position 123"
}
```

### 2. Frontend Route & Page

**Route:** Add `/pipelines` to `src/ui/client/main.jsx`

**Page Component:** `src/pages/PipelineList.jsx`

Features:

- Minimal, clean design following existing UI patterns
- Use Radix UI components (Card, Heading, Text) for consistency
- Fetch data from `/api/pipelines` endpoint using existing API client patterns
- Display pipeline cards with name, description, and slug
- Loading and error states following existing patterns
- Responsive grid layout for pipeline cards

### 3. Navigation Integration

**File:** Update `src/components/Layout.jsx`

Changes:

- Add "Pipelines" navigation link to header navigation
- Use appropriate icon (e.g., `List` or `Folder` from Lucide React)
- Follow existing navigation pattern and styling with `isActivePath` logic
- Ensure responsive design matches current header layout
- Add proper accessibility attributes

### 4. API Integration

**File:** Update `src/ui/express-app.js`

Changes:

- Import the new pipelines endpoint handler
- Add route: `app.get("/api/pipelines", async (req, res) => { await handlePipelinesRequest(req, res); });`
- Follow existing route pattern structure with proper error handling

## Key Design Decisions (Following Engineering Standards)

### Simplicity First

- Single API endpoint returning all pipelines (no pagination needed for small registry)
- Minimal page design focused on information display
- No complex state management needed
- Leverage existing configuration system rather than creating new abstractions

### Explicit Boundaries

- Backend: Pure data endpoint using existing config system
- Frontend: Simple presentational component
- Clear separation between data fetching and display
- No premature abstractions

### Boring Technology

- Use existing patterns for API endpoints (no new frameworks)
- Leverage existing config loading system
- Follow established UI component patterns
- No "flexibility" features for hypothetical future needs

### Data Flow

```
registry.json → config.js → pipelines-endpoint.js → API → React page → UI
```

## Files to Create/Modify

### New Files

- `src/ui/endpoints/pipelines-endpoint.js` - API handler
- `src/pages/PipelineList.jsx` - Page component

### Modified Files

- `src/ui/express-app.js` - Add route
- `src/ui/client/main.jsx` - Add route
- `src/components/Layout.jsx` - Add navigation
- `tests/api.test.js` - Add pipeline endpoint tests
- `tests/PipelineList.test.jsx` - Component tests (follow existing naming)

## Testing Strategy

### API Tests (Added to `tests/api.test.js`)

Following the existing pattern of adding endpoint tests to the existing API test file:

- Test successful pipeline listing with expected response format
- Test empty pipelines array when no pipelines registered
- Test error handling for malformed registry JSON
- Test response format validation
- Test endpoint middleware behavior (CORS headers, etc.)

### Component Tests (`tests/PipelineList.test.jsx`)

Following existing component test patterns:

- Test rendering with pipeline data using mock API response
- Test loading state display during data fetch
- Test error state display when API fails
- Test responsive grid layout with different screen sizes
- Test accessibility attributes on navigation elements

### Integration Testing

- Manual testing of full flow from API to component rendering
- Test navigation routing functionality in development
- Validate responsive design across device sizes

## Implementation Steps

### 0. Prerequisite - Registry Field Consistency Fix

**First, fix the registry field inconsistency in `src/core/config.js`:**

- Update `normalizeRegistryEntry()` function to handle both `pipelinePath` and `pipelineJsonPath`
- Add tests to verify backward compatibility with existing registry format
- Verify the fix doesn't break existing pipeline loading functionality

### 1. Backend API Endpoint

- Create `pipelines-endpoint.js` with proper error handling
- Add route to `express-app.js`
- Add comprehensive tests to existing `tests/api.test.js`

### 2. Frontend Page Component

- Create `PipelineList.jsx` with clean, minimal design
- Implement data fetching using existing patterns
- Add loading and error states
- Write component tests following existing patterns

### 3. Navigation Integration

- Add navigation link to `Layout.jsx`
- Update routing in `main.jsx`
- Test navigation functionality

### 4. Testing & Validation

- Run full test suite including new tests
- Manual testing in development
- Validate responsive design
- Test error handling scenarios (empty registry, malformed JSON)

## Risk Assessment & Mitigations

### Risks

- **Registry file not found**: Handled with proper error messages and fallback behavior
- **Invalid registry format**: Validate JSON structure and provide clear error messages
- **Navigation conflicts**: Ensure new route doesn't conflict with existing routes
- **Performance**: Minimal risk with small registry size

### Mitigations

- Follow existing error handling patterns consistently
- Use existing validation logic from config system
- Leverage established routing patterns
- Keep implementation simple and focused

## Success Criteria

### Prerequisites

- [ ] Registry field inconsistency fixed in `src/core/config.js`
- [ ] Backward compatibility maintained with existing registry format
- [ ] Existing pipeline loading functionality unaffected

### Core Feature

- [ ] Backend API endpoint returns correct pipeline data with proper error handling
- [ ] Frontend page displays pipelines in clean, usable format
- [ ] Navigation integration works seamlessly with `/pipelines` route

### Error Handling & Edge Cases

- [ ] Empty registry returns 200 with empty array (not error)
- [ ] Malformed registry JSON returns 500 with specific error message
- [ ] Loading and error states displayed properly in UI

### Quality & Standards

- [ ] All tests pass with good coverage (API tests added to existing file)
- [ ] Responsive design works on different screen sizes
- [ ] Implementation follows existing code patterns and engineering standards
- [ ] No new test files created unnecessarily (tests added to existing files)

This plan prioritizes simplicity, leverages existing architecture, and follows the project's engineering standards while delivering a functional pipeline listing feature.
