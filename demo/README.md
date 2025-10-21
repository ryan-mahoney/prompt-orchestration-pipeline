# Demo

NPM commands:

- Run the demo:
  - npm run demo:all

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

**Fields:**

- `name`: Unique identifier for the job (alphanumeric, hyphens, and underscores only)
- `pipeline`: Valid pipeline slug from `demo/pipeline-config/registry.json` (e.g., "content-generation")
- `data`: Object containing the input data for the pipeline (optional)

## Usage Notes

- Seeds should be submitted the same way as production:
  - Drop seed JSON files into demo/pipeline-data/pending
  - Or use the upload API: POST /api/upload/seed
