# Add Pipeline Type Feature - Implementation Plan

## Overview

Add the ability to create new pipeline types from the PipelineList page with automatic slug generation and starter file creation.

## Requirements

### User Interface

- Button labeled "Add a Pipeline Type" in top-right header of PipelineList page
- Clicking opens a slide-over sidebar from the right
- Form embedded in sidebar with minimal user input
- After successful creation, redirect to `/pipelines/{slug}`

### Form Fields (User Input Only)

- **name** (required): Human-readable pipeline name
- **description** (required): Pipeline description

### Auto-Generated Values

The system will automatically generate:

- **slug**: Derived from name using kebab-case, ensured unique
- **pipelinePath**: `pipeline-config/{slug}/pipeline.json`
- **taskRegistryPath**: `pipeline-config/{slug}/tasks/index.js`

### Starter Files

The system will create initial starter files:

- `pipeline-config/{slug}/pipeline.json` - Empty pipeline config template
- `pipeline-config/{slug}/tasks/index.js` - Empty task registry template
- `pipeline-config/{slug}/tasks/` directory

## Architecture

### Components

#### Frontend Components

1. **PipelineList.jsx** (modify)
   - Add state for sidebar open/close
   - Render "Add a Pipeline Type" button in PageSubheader
   - Integrate AddPipelineSidebar component

2. **AddPipelineSidebar.jsx** (new)
   - Slide-over panel (right side, z-index 2000)
   - Form with two fields: name, description
   - Both fields required with validation
   - Submit button with loading state
   - Error message display
   - Success: close sidebar + navigate to `/pipelines/{slug}`

#### Backend Components

3. **create-pipeline-endpoint.js** (new)
   - `handleCreatePipelineRequest()` - Core logic
   - `handleCreatePipelineHttpRequest()` - HTTP wrapper
   - Accepts `{ name, description }` in request body
   - Generates slug from name (kebab-case)
   - Ensures slug uniqueness (appends suffix if needed)
   - Generates pipelinePath and taskRegistryPath
   - Creates directory structure and starter files
   - Updates registry.json atomically
   - Returns success with pipeline slug

4. **express-app.js** (modify)
   - Add `POST /api/pipelines` route

## Data Flow

```
User clicks "Add a Pipeline Type" button
  ↓
AddPipelineSidebar opens with empty form
  ↓
User enters name and description, submits
  ↓
POST /api/pipelines with { name, description }
  ↓
Backend validates: name and description present
  ↓
Generate slug from name (kebab-case)
  ↓
Check slug uniqueness in registry
  ↓  (if duplicate, append -1, -2, etc.)
Generate paths:
  - pipelineConfigDir = pipeline-config/{slug}/
  - pipelinePath = pipeline-config/{slug}/pipeline.json
  - taskRegistryPath = pipeline-config/{slug}/tasks/index.js
  ↓
Create directory structure:
  - pipeline-config/{slug}/tasks/
  ↓
Create starter files:
  - pipeline.json with empty template
  - tasks/index.js with empty task registry template
  ↓
Update registry.json:
  - Read existing registry
  - Parse JSON
  - Add new pipeline entry
  - Write back atomically
  ↓
Return { ok: true, data: { slug, name, description, pipelinePath, taskRegistryPath } }
  ↓
Sidebar closes
  ↓
Navigate to /pipelines/{slug}

If error at any step:
  Return { ok: false, code, message, errors }
  ↓
Sidebar displays error message
```

## API Contract

### POST /api/pipelines

**Request Body:**

```json
{
  "name": "My Pipeline",
  "description": "A sample pipeline for demonstration"
}
```

**Success Response (200):**

```json
{
  "ok": true,
  "data": {
    "slug": "my-pipeline",
    "name": "My Pipeline",
    "description": "A sample pipeline for demonstration",
    "pipelinePath": "pipeline-config/my-pipeline/pipeline.json",
    "taskRegistryPath": "pipeline-config/my-pipeline/tasks/index.js"
  }
}
```

**Error Responses:**

Missing fields (400):

```json
{
  "ok": false,
  "code": "validation_error",
  "message": "Missing required fields",
  "errors": {
    "name": "Name is required",
    "description": "Description is required"
  }
}
```

Registry I/O error (500):

```json
{
  "ok": false,
  "code": "fs_error",
  "message": "Failed to update pipeline registry"
}
```

File creation error (500):

```json
{
  "ok": false,
  "code": "fs_error",
  "message": "Failed to create pipeline files"
}
```

## Implementation Details

### Slug Generation Algorithm

```javascript
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphen
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .substring(0, 50); // Max 50 chars
}

function ensureUniqueSlug(baseSlug, existingSlugs) {
  let slug = baseSlug;
  let suffix = 1;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return slug;
}
```

### Starter File Templates

**pipeline.json:**

```json
{
  "name": "Generated Name",
  "description": "Generated Description",
  "stages": [],
  "defaultTaskConfig": {}
}
```

**tasks/index.js:**

```javascript
// Task registry for {slug}
// Add task definitions here following the pattern in demo/pipeline-config/content-generation/tasks/
export const tasks = {};
```

### Atomic Registry Update Pattern

```javascript
const registryPath = path.join(rootDir, "pipeline-config", "registry.json");
const registryData = JSON.parse(await fs.readFile(registryPath, "utf8"));
registryData.pipelines[slug] = {
  name,
  description,
  pipelinePath,
  taskRegistryPath,
};
await fs.writeFile(registryPath, JSON.stringify(registryData, null, 2), "utf8");
```

### Directory Structure After Creation

```
pipeline-config/
├── registry.json              (updated)
└── my-pipeline/               (new directory)
    ├── pipeline.json          (new file)
    └── tasks/                 (new directory)
        └── index.js          (new file)
```

## Validation Rules

### Frontend Validation

- `name`: required, non-empty, max 100 chars
- `description`: required, non-empty, max 500 chars

### Backend Validation

- `name`: required, non-empty string
- `description`: required, non-empty string
- Generated slug: valid kebab-case, unique in registry
- Registry file: valid JSON structure
- File system: write permissions

## Error Handling

### Error Codes

| Code               | Description                     |
| ------------------ | ------------------------------- |
| `validation_error` | Missing or invalid input fields |
| `fs_error`         | File system operation failed    |
| `invalid_json`     | Registry JSON is malformed      |
| `internal_error`   | Unexpected server error         |

### User-Facing Messages

- Validation errors: Clear inline messages per field
- I/O errors: General message suggesting retry or contact admin
- Success: Toast notification + automatic navigation

## Testing Strategy (Manual)

### Frontend Testing

1. Navigate to `/pipelines` page
2. Verify "Add a Pipeline Type" button appears in header
3. Click button, verify sidebar opens
4. Submit empty form, verify validation errors appear
5. Fill form with valid data, submit
6. Verify success toast appears
7. Verify redirect to new pipeline detail page
8. Verify new pipeline appears in list
9. Verify pipeline files were created

### Backend Testing

1. Create pipeline with simple name
2. Create pipeline with name requiring slug conversion (e.g., "My Cool Pipeline!")
3. Create pipeline with name that conflicts with existing slug
4. Create pipeline with empty fields (should fail)
5. Create pipeline and verify registry.json is updated
6. Verify directory structure and starter files created
7. Verify starter files have correct content

### Edge Cases

- Very long name (>50 chars)
- Name with special characters
- Name with only non-ASCII characters
- Name that results in duplicate slugs
- Missing or corrupted registry.json

## Risks & Mitigations

| Risk                                     | Mitigation                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| Slug collision after concurrent requests | Simple slug suffixing; for production, add file locking |
| Registry corruption during write         | Atomic read-modify-write pattern                        |
| Permission denied creating files         | Clear error message to user                             |
| Starter file templates become outdated   | Keep templates simple and minimal                       |
| User provides invalid characters in name | Slug generation sanitizes input                         |

## Implementation Phases

1. **Phase 1: Backend Endpoint**
   - Create `create-pipeline-endpoint.js`
   - Implement slug generation and uniqueness check
   - Implement directory and file creation
   - Implement registry update
   - Add error handling

2. **Phase 2: Express Route**
   - Add `POST /api/pipelines` route in `express-app.js`
   - Wire up endpoint handler

3. **Phase 3: Frontend Sidebar**
   - Create `AddPipelineSidebar.jsx` component
   - Implement form with name/description fields
   - Implement API integration
   - Implement success/error handling

4. **Phase 4: Integration**
   - Modify `PipelineList.jsx` to add button
   - Wire up sidebar state management
   - Implement navigation on success

5. **Phase 5: Manual Testing**
   - Test all user flows
   - Test edge cases
   - Verify file creation and registry updates
