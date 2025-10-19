
## Multi-Pipeline Configuration

### Directory Structure

Pipelines are organized by slug under `pipeline-config/`:

```
pipeline-config/
  content/
    pipeline.json
    tasks/
      task-example.js
```

### Registry Format

Configuration includes a `pipelines` registry:

```javascript
{
  pipelines: {
    content: {
      configDir: 'pipeline-config/content',
      tasksDir: 'pipeline-config/content/tasks'
    }
  }
}
```

Each entry must have `configDir` (path to directory containing `pipeline.json`) and `tasksDir` (path to tasks directory).

### Migration

**Before:**

```javascript
const configPath = config.configDir + "/pipeline.json";
```

**After:**

```javascript
const pipelineConfig = getPipelineConfig("content");
const configPath = pipelineConfig.pipelineJsonPath;
```

### Breaking Changes

- Pipeline paths moved under slug directories (`pipeline-config/<slug>/`)
- Single `configDir` default removed from configuration
- Code must use `getPipelineConfig(slug)` to access pipeline paths

