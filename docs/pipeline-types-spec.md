# Pipeline Listing Feature Specification

## Qualifications

- **NodeJS**: Backend API development with Express.js
- **Data Processing**: JSON parsing and validation
- **Frontend**: React component development with modern hooks
- **File System**: Configuration file reading and error handling
- **API Design**: RESTful endpoint design with proper error responses
- **Testing**: Unit testing for API endpoints and React components

## Problem Statement

The system currently has no way for users to discover available pipelines. Pipeline definitions exist in a registry file (`pipeline-config/registry.json`) and are loaded by the configuration system, but there's no API endpoint or UI to list them. Users must know pipeline slugs in advance to use the system.

## Goal

Provide a simple, discoverable interface for users to browse available pipelines through:

1. A `GET /api/pipelines` endpoint that returns pipeline metadata
2. A `/pipelines` page displaying pipeline cards in a responsive grid
3. Navigation integration in the main header

## Architecture

### Data Flow

```
registry.json → config.js → pipelines-endpoint.js → API → React component → UI
```

### Components

**Backend:**

- `src/ui/endpoints/pipelines-endpoint.js`: Pure data endpoint using existing config system
- `src/ui/express-app.js`: Route registration

**Frontend:**

- `src/pages/PipelineList.jsx`: Presentational component for pipeline cards
- `src/ui/client/main.jsx`: Route registration
- `src/components/Layout.jsx`: Navigation integration

### Boundaries

- **API Layer**: Reads from config system, transforms data for UI consumption
- **UI Layer**: Fetches from API, handles loading/error states, renders cards
- **Navigation**: Simple route-based integration with existing pattern

## Acceptance Criteria

### Backend API

- [ ] `GET /api/pipelines` returns structured pipeline data
- [ ] Success response includes slug, name, description for each pipeline
- [ ] Empty registry returns 200 with empty `pipelines` array
- [ ] Invalid registry JSON returns 500 with specific error message
- [ ] Missing registry file returns 200 with empty array (not 404)

### Frontend Interface

- [ ] `/pipelines` route renders PipelineList component
- [ ] Pipeline cards display name and description in responsive grid
- [ ] Loading state shown during data fetch
- [ ] Error state displayed when API fails
- [ ] Cards use consistent styling with existing components

### Navigation Integration

- [ ] "Pipelines" link added to main navigation header
- [ ] Link routes to `/pipelines` with proper active state styling
- [ ] Navigation maintains responsive behavior

### Error Handling

- [ ] API errors bubble up to user-friendly messages
- [ ] Network failures handled gracefully
- [ ] Invalid data responses handled without breaking UI

## Notes

### Engineering Standards Applied

**Simplicity First:**

- Single endpoint, no pagination for small registry
- Pure functional components, no complex state management
- Leverage existing config system without abstractions

**Explicit Boundaries:**

- Clear separation between config loading and API response
- Frontend component isolated from config implementation
- No shared state between components

**Boring Technology:**

- Existing Express.js patterns for endpoints
- Standard React hooks for data fetching
- No custom frameworks or "flexibility" features

**Let It Crash:**

- API errors surface with specific messages
- No defensive fallbacks for malformed data
- Configuration failures bubble up as 500 errors

### Design Decisions

- **Registry Field Handling**: Config system updated to handle both `pipelinePath` and `pipelineJsonPath` for compatibility
- **Error Response Format**: Consistent with existing API patterns (`ok`, `data`, `error`, `message`)
- **Component Structure**: Single-purpose presentational component following existing patterns
- **Testing Strategy**: Tests added to existing files, no new test infrastructure

## Implementation Steps

1. **Fix Registry Field Inconsistency**
   - Update `src/core/config.js` `normalizeRegistryEntry()` function
   - Add support for both `pipelinePath` and `pipelineJsonPath` fields
   - Maintain backward compatibility with existing registry format

2. **Create Pipelines API Endpoint**
   - Create `src/ui/endpoints/pipelines-endpoint.js`
   - Implement `handlePipelinesRequest()` function using existing config system
   - Handle empty registry (return 200 with empty array)
   - Handle malformed JSON (return 500 with specific error)
   - Use existing `sendJson` utility for responses

3. **Register API Route**
   - Update `src/ui/express-app.js`
   - Import pipelines endpoint handler
   - Add `GET /api/pipelines` route following existing pattern
   - Ensure proper error handling middleware

4. **Create PipelineList Component**
   - Create `src/pages/PipelineList.jsx`
   - Implement functional component with React hooks
   - Add data fetching from `/api/pipelines` endpoint
   - Implement loading state during fetch
   - Implement error state for failed requests
   - Create responsive grid layout using Tailwind CSS
   - Use Radix UI Card components for consistency

5. **Register Frontend Route**
   - Update `src/ui/client/main.jsx`
   - Add `/pipelines` route with PipelineList component
   - Follow existing route pattern structure

6. **Add Navigation Link**
   - Update `src/components/Layout.jsx`
   - Add "Pipelines" navigation link with Lucide React icon
   - Implement `isActivePath` logic for active state styling
   - Ensure proper accessibility attributes

7. **Add API Tests**
   - Update `tests/api.test.js`
   - Add test suite for `/api/pipelines` endpoint
   - Test successful response with pipeline data
   - Test empty registry response
   - Test malformed JSON error handling
   - Test response format validation

8. **Add Component Tests**
   - Create `tests/PipelineList.test.jsx`
   - Test component rendering with mock pipeline data
   - Test loading state display
   - Test error state display
   - Test responsive grid layout
   - Test accessibility attributes
