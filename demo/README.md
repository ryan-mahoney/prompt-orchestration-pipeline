# Demo

This demo no longer uses a bespoke runner. To make the demo behave exactly like production, run the production server with the `PO_ROOT` environment variable set to the `demo/` directory.

Recommended commands:

- Development (with hot reload):
  - PO_ROOT=demo npm run ui
- Production (build UI then run server):
  - npm run ui:build
  - NODE_ENV=production PO_ROOT=demo node src/ui/server.js
- Shortcut npm script:
  - npm run demo:run # starts the production server with PO_ROOT=demo (uses src/ui/server.js)

## JobId-Only Navigation

**Important**: This demo uses JobId-only navigation. All pipeline detail pages use `/pipeline/:jobId` URLs with no slug-based fallbacks.

### Directory Structure

The demo uses ID-based storage exclusively:

```
demo/pipeline-data/
├── pending/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   └── ...
├── current/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   ├── tasks-status.json
│   │   └── ...
├── complete/
│   ├── {jobId}/
│   │   ├── seed.json
│   │   ├── tasks-status.json
│   │   └── ...
└── rejected/
    ├── {jobId}/
    │   ├── seed.json
    │   └── ...
```

### Accessing Pipeline Details

- **Valid**: `/pipeline/abc123def456` - Loads job with ID `abc123def456`
- **Invalid**: `/pipeline/content-generation` - Shows "Invalid job ID" error

### Migration from Legacy Data

If you have existing demo data with process-named folders (e.g., `content-generation`), run the migration script:

```bash
node scripts/migrate-demo-fs.js
```

This will:

- Convert process-named folders to ID-based directories
- Preserve all existing job data
- Create manifests for traceability

## Seed Examples

All seeds must include a `pipeline` field that references a valid pipeline slug from the registry. The pipeline field is mandatory and no fallbacks are allowed.

**Example seed for content-generation pipeline:**

```json
{
  "name": "my-content-job",
  "pipeline": "content-generation",
  "data": {
    "type": "content-creation",
    "topic": "AI-Powered Development Tools",
    "contentType": "blog-post",
    "targetAudience": "software-developers",
    "tone": "professional-yet-accessible",
    "length": "1500-2000 words",
    "keywords": ["AI", "developer tools", "productivity", "automation"],
    "outputFormat": "blog-post"
  }
}
```

**Required fields:**

- `name`: Unique identifier for the job (alphanumeric, hyphens, and underscores only)
- `pipeline`: Valid pipeline slug from `demo/pipeline-config/registry.json` (e.g., "content-generation")
- `data`: Object containing the input data for the pipeline

## Usage Notes

- The old `demo/run-demo.js` runner is deprecated. A shim remains for backward compatibility but it simply warns and forwards to the production server.
- Seeds should be submitted the same way as production:
  - Drop seed JSON files into demo/pipeline-data/pending
  - Or use the upload API: POST /api/upload/seed
- Do not rely on scenario flags or automatic loading of demo/seeds/\*.json — the demo is intentionally kept behaviorally identical to production.
- **No slug resolution**: The system will not attempt to resolve pipeline names like "content-generation" to job IDs.

## Error Handling

- **Invalid job ID**: Shows "Invalid job ID" for malformed IDs
- **Job not found**: Shows "Job not found" for valid IDs that don't exist
- **Network errors**: Shows appropriate network error messages
