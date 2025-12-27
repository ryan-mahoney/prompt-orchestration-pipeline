This is a great design question. Let me first look at the third file to get a complete picture, then give you my recommendation.Now I have a complete picture. These three files show consistent patterns that inform a good design. Let me give you my recommendations:

## 1. Recommended Data Structure

```typescript
interface TaskAnalysis {
  taskId: string;
  filePath: string;

  // Stages in execution order
  stages: StageDefinition[];

  // Aggregate I/O across all stages
  artifacts: {
    reads: ArtifactReference[];
    writes: ArtifactReference[];
  };

  // Models used anywhere in task
  models: ModelReference[];

  // For pipeline-level views: what's available at each stage
  availableAtStage: Record<string, string[]>; // stageName → artifact names
}

interface StageDefinition {
  name: string;
  order: number;
  signature: {
    inputs: string[]; // e.g., ["io", "llm", "data.ingestion", "flags"]
    outputs: string[]; // e.g., ["roleName", "levels", "attributeModelsByLevel"]
  };
  artifacts: {
    reads: ArtifactReference[];
    writes: ArtifactReference[];
  };
  models: ModelReference[];
}

interface ArtifactReference {
  fileName: string; // "meta.json" or "competency-model-${level.id}.json"
  isDynamic: boolean; // template literal detection
  dynamicPattern?: string; // regex pattern if dynamic: "competency-model-[^.]+\\.json"
  required: boolean; // false if wrapped in try/catch
  stage: string; // which stage accesses it
  operation: "read" | "write";

  // LLM-deduced fields
  schema?: JSONSchema; // deduced structure
  sampleData?: unknown; // example content
  description?: string; // what this file contains
}

interface ModelReference {
  provider: string; // "openai", "deepseek"
  method: string; // "gpt5Mini", "chat"
  callPath: string; // "llm.openai.gpt5Mini"
  stage: string;

  // LLM-deduced
  purpose?: string; // "generates attribute questions"
}
```

## 2. Algorithmic vs LLM Deduction

Here's my breakdown:

| Property                              | Method             | Rationale                                              |
| ------------------------------------- | ------------------ | ------------------------------------------------------ |
| **Stage names & order**               | AST parsing        | Deterministic: `export const X = async`                |
| **Stage signatures (inputs/outputs)** | AST parsing        | Destructuring patterns are explicit                    |
| **Artifact reads**                    | AST + regex        | `io.readArtifact("...")` is consistent                 |
| **Artifact writes**                   | AST + regex        | `io.writeArtifact("...")` is consistent                |
| **Dynamic file names**                | AST                | Template literal detection                             |
| **Required vs optional**              | AST (control flow) | try/catch wrapping is structural                       |
| **Model calls**                       | AST + regex        | `llm.X.Y(...)` pattern is consistent                   |
| **Available at stage**                | Computed           | Union of all writes from prior stages + initial inputs |
| **Output schemas**                    | **LLM**            | Embedded in prompts as text, varies wildly             |
| **Sample data**                       | **LLM**            | Requires understanding prompt intent                   |
| **Descriptions/purpose**              | **LLM**            | Semantic understanding                                 |

## 3. Should You Just Use LLM for Everything?

**No.** Here's why:

**AST parsing advantages:**

- **Deterministic & auditable** — same input always produces same output
- **Fast & cheap** — no API calls, runs in milliseconds
- **Complete coverage** — won't miss an `io.readArtifact` call buried in a loop
- **Provides anchors** — tells the LLM exactly where to look

**LLM advantages:**

- Understanding prompt text to deduce output schemas
- Generating realistic sample data
- Semantic descriptions of what stages/files do

**My recommended hybrid approach:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: AST Parsing (deterministic)                          │
│  ─────────────────────────────────────────────────────────────  │
│  • Extract all stage names and order                           │
│  • Find all io.readArtifact / io.writeArtifact calls           │
│  • Detect try/catch wrapping for required vs optional          │
│  • Find all llm.*.* calls                                      │
│  • Extract prompt template functions                           │
│  • Track data flow between stages                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Compute derived properties                           │
│  ─────────────────────────────────────────────────────────────  │
│  • availableAtStage = union of writes from all prior stages    │
│  • dynamicPattern regex from template literals                 │
│  • Aggregate models/artifacts at task level                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: LLM enrichment (optional, on-demand)                 │
│  ─────────────────────────────────────────────────────────────  │
│  Input: Extracted prompts + artifact names + stage context     │
│  Ask LLM to deduce:                                            │
│    • JSON schema for each written artifact                     │
│    • Sample data for each artifact                             │
│    • Human-readable description of each stage                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight from your files:** The prompt templates in your code _literally contain the output schema as text_. Look at `questions-for-attributes.js` lines 190-227 — the schema is right there in the system prompt. An LLM can extract and formalize that into a JSON Schema trivially, but regex/AST cannot.

## Practical Implementation Sketch

```javascript
// Phase 1: Parse with AST
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";

function analyzeTask(code: string): TaskAnalysis {
  const ast = parser.parse(code, { sourceType: "module" });

  const stages: StageDefinition[] = [];
  const artifactReads: ArtifactReference[] = [];
  const artifactWrites: ArtifactReference[] = [];
  const models: ModelReference[] = [];

  traverse(ast, {
    // Find exported async functions (stages)
    ExportNamedDeclaration(path) {
      if (path.node.declaration?.type === "VariableDeclaration") {
        // extract stage name, order from position, signature from params
      }
    },

    // Find io.readArtifact calls
    CallExpression(path) {
      if (isArtifactRead(path)) {
        const fileName = extractFileName(path);
        const inTryCatch = isInsideTryCatch(path);
        artifactReads.push({ fileName, required: !inTryCatch, ... });
      }
      if (isArtifactWrite(path)) { /* similar */ }
      if (isLLMCall(path)) { /* extract provider, method */ }
    }
  });

  return { stages, artifacts: { reads: artifactReads, writes: artifactWrites }, models };
}

// Phase 3: LLM enrichment (separate, optional call)
async function enrichWithSchemas(analysis: TaskAnalysis, code: string) {
  const prompts = extractPromptTemplates(code); // AST-extracted

  const response = await llm.chat({
    system: `You analyze LLM pipeline code to deduce output schemas...`,
    user: `Given these artifacts and prompts, deduce JSON schemas:
      Artifacts written: ${JSON.stringify(analysis.artifacts.writes)}
      Prompt templates: ${prompts}

      Return { "artifact-name.json": { schema: JSONSchema, sample: {...} } }`
  });

  // Merge LLM response into analysis
}
```

## Summary

| Approach             | Use For                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| **AST parsing only** | Stages, artifact I/O, model calls, required/optional, dynamic patterns |
| **Computed**         | Available-at-stage, aggregate counts                                   |
| **LLM**              | Schema deduction from prompts, sample data, descriptions               |

The hybrid approach gives you the best of both worlds: deterministic extraction of structural properties (which you need to be reliable for pipeline tooling), and LLM intelligence for the semantic/schema stuff that's genuinely hard to parse algorithmically.
