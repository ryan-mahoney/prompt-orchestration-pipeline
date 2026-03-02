# Module Specification: `task-analysis`

## 1. Purpose & Responsibilities

The `task-analysis` module is a **static analysis library** that extracts structured metadata from pipeline task source code. Pipeline tasks are JavaScript/JSX modules whose exported functions represent sequential processing stages. This module parses that source code into an abstract syntax tree and extracts three categories of metadata:

- **Stages** -- the exported functions that define a task's processing pipeline, including their execution order and async status.
- **Artifact I/O** -- all `io.readArtifact` and `io.writeArtifact` calls, capturing which files are read or written, in which stage, and whether reads are required or optional.
- **LLM calls** -- all invocations of LLM providers (e.g., `llm.deepseek.chat(...)`), capturing provider name, method name, and enclosing stage.

Beyond static extraction, the module provides **enrichment capabilities**:

- **Schema deduction** -- uses an LLM service to infer JSON Schema definitions for artifacts based on surrounding code context.
- **Artifact resolution** -- uses an LLM service to resolve dynamic (non-literal) artifact references to known artifact filenames.
- **Persistence** -- writes analysis results and deduced schemas to disk in structured JSON formats.

**Boundaries:**

- This module does NOT execute task code. It operates entirely on source text.
- It does NOT manage pipelines, orchestrate task execution, or interact with the runtime. It is a pure analysis/metadata-extraction library.
- It does NOT own the LLM provider infrastructure -- it delegates to the shared `llm` module for chat completions.
- It acts as a **transformer** (source code in, structured metadata out) and a **gateway** to LLM-powered enrichment services.

---

## 2. Public Interface

### 2.1 `analyzeTask(code, taskFilePath?)`

**Source:** `src/task-analysis/index.js`

- **Purpose:** Main entry point. Parses task source code and extracts all metadata (stages, artifacts, models) in a single call.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `code` | string | No | The full source code of a pipeline task file |
| `taskFilePath` | string or null | Yes (default: `null`) | Absolute path to the task file on disk; stored as metadata in the result |

- **Return value:** A `TaskAnalysis` object (see Section 3). Returned synchronously.
- **Thrown errors:** Propagates parse errors from `parseTaskSource` and extraction errors from each extractor (e.g., if an `io.readArtifact` call is found outside an exported function).

### 2.2 `writeAnalysisFile(pipelinePath, taskName, analysisData)`

**Source:** `src/task-analysis/enrichers/analysis-writer.js` (re-exported from `index.js`)

- **Purpose:** Persists a `TaskAnalysis` object to disk as a JSON file in the pipeline's `analysis/` directory.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `pipelinePath` | string | No | Absolute path to the pipeline directory |
| `taskName` | string | No | Task identifier used as the output file stem (e.g., `"research"` produces `research.analysis.json`) |
| `analysisData` | TaskAnalysis | No | The analysis result object to persist |

- **Return value:** A promise that resolves to `undefined` on success.
- **Thrown errors:** Throws if `analysisData` is missing required fields or has invalid types:
  - `taskFilePath` must be a non-null, non-empty string (note: `analyzeTask` can return `taskFilePath: null`, which will fail validation)
  - `stages`, `models` must be arrays
  - `artifacts` must be an object with `reads` and `writes` arrays
  - `artifacts.unresolvedReads` and `artifacts.unresolvedWrites` are validated if present (must be arrays)
  - Propagates file system errors from directory creation or file writing.

### 2.3 `parseTaskSource(code)`

**Source:** `src/task-analysis/parser.js`

- **Purpose:** Parses JavaScript/JSX source code into a Babel AST.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `code` | string | No | Source code to parse |

- **Return value:** A Babel `File` AST node.
- **Thrown errors:** If parsing fails, throws an `Error` with the syntax error location (line/column) and message. The original error is attached as `cause`.

### 2.4 `extractStages(ast)`

**Source:** `src/task-analysis/extractors/stages.js`

- **Purpose:** Extracts all exported function declarations from the AST, treating each as a pipeline stage.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `ast` | Babel `File` node | No | The parsed AST of a task file |

- **Return value:** An array of `Stage` objects, sorted ascending by `order` (source line number).
- **Thrown errors:** None explicitly thrown; returns an empty array if no exported functions are found.

### 2.5 `extractArtifactReads(ast, sourceCode?)`

**Source:** `src/task-analysis/extractors/artifacts.js`

- **Purpose:** Extracts all `io.readArtifact(...)` calls from the AST.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `ast` | Babel `File` node | No | The parsed AST |
| `sourceCode` | string | Yes | Original source code, used to extract surrounding code context for unresolved references |

- **Return value:** An object `{ reads: ArtifactRead[], unresolvedReads: UnresolvedRead[] }`. Resolved reads have a literal `fileName`; unresolved reads have a dynamic `expression` that could not be statically determined.
- **Thrown errors:** Throws if an `io.readArtifact` call is found outside an exported function.

### 2.6 `extractArtifactWrites(ast, sourceCode?)`

**Source:** `src/task-analysis/extractors/artifacts.js`

- **Purpose:** Extracts all `io.writeArtifact(...)` calls from the AST.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `ast` | Babel `File` node | No | The parsed AST |
| `sourceCode` | string | Yes | Original source code, used to extract surrounding code context for unresolved references |

- **Return value:** An object `{ writes: ArtifactWrite[], unresolvedWrites: UnresolvedWrite[] }`.
- **Thrown errors:** Throws if an `io.writeArtifact` call is found outside an exported function.

### 2.7 `extractCodeContext(path, sourceCode)`

**Source:** `src/task-analysis/extractors/artifacts.js`

- **Purpose:** Extracts up to 5 lines of surrounding source code (2 lines before and 2 lines after) for a given AST node. Used to provide context for unresolved artifact references.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `path` | Babel `NodePath` | No | The AST path of the node whose context to extract |
| `sourceCode` | string | No | The full original source code |

- **Return value:** A string containing the surrounding lines, or an empty string if source code or location information is unavailable.
- **Thrown errors:** None.

### 2.8 `extractLLMCalls(ast)`

**Source:** `src/task-analysis/extractors/llm-calls.js`

- **Purpose:** Extracts all LLM provider method calls from the AST.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `ast` | Babel `File` node | No | The parsed AST |

- **Return value:** An array of `ModelCall` objects.
- **Thrown errors:** Throws if an LLM call is found outside an exported function.

### 2.9 `deduceArtifactSchema(taskCode, artifact)`

**Source:** `src/task-analysis/enrichers/schema-deducer.js`

- **Purpose:** Uses an LLM to analyze task source code and infer a JSON Schema Draft-07 definition for a specific artifact.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `taskCode` | string | No | Full source code of the task file |
| `artifact` | object | No | Artifact descriptor with `fileName` (string) and `stage` (string) |

- **Return value:** A promise resolving to `{ schema: object, example: object, reasoning: string }`. The `schema` is a valid JSON Schema Draft-07 object. The `example` is realistic sample data that has been validated against the schema. The `reasoning` explains the LLM's analysis steps.
- **Thrown errors:** Throws in the following scenarios:
  1. The `chat` response itself is missing or not an object
  2. `response.content` is missing or not an object
  3. The parsed content lacks required properties (`schema`, `example`, `reasoning`) or they have wrong types
  4. The generated example fails Ajv validation against the generated schema

### 2.10 `writeSchemaFiles(pipelinePath, artifactName, deducedData)`

**Source:** `src/task-analysis/enrichers/schema-writer.js`

- **Purpose:** Persists deduced schema data to disk as three separate files in the pipeline's `schemas/` directory.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `pipelinePath` | string | No | Absolute path to the pipeline directory |
| `artifactName` | string | No | The artifact filename (e.g., `"output.json"`); the file stem is used for output filenames |
| `deducedData` | object | No | Object with `schema`, `example`, and `reasoning` properties |

- **Return value:** A promise resolving to `undefined` on success.
- **Thrown errors:** Throws if `deducedData` is missing or has invalid types for `schema`, `example`, or `reasoning`. Propagates file system errors.

### 2.11 `resolveArtifactReference(taskCode, unresolvedArtifact, availableArtifacts)`

**Source:** `src/task-analysis/enrichers/artifact-resolver.js`

- **Purpose:** Uses an LLM to resolve a dynamic (non-literal) artifact expression to one of the known artifact filenames.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `taskCode` | string | No | Full source code of the task file |
| `unresolvedArtifact` | object | No | Object with `expression` (the dynamic code), `codeContext` (surrounding lines), and `stage` (enclosing stage name) |
| `availableArtifacts` | string[] | No | List of known artifact filenames to match against |

- **Return value:** A promise resolving to `{ resolvedFileName: string|null, confidence: number, reasoning: string }`. If the LLM's suggested filename is not in `availableArtifacts`, `resolvedFileName` is forced to `null` and `confidence` to `0`.
- **Thrown errors:** Never throws. Catches all errors and returns `{ resolvedFileName: null, confidence: 0, reasoning: "Failed to analyze artifact reference" }`.

### 2.12 `isInsideTryCatch(path)`

**Source:** `src/task-analysis/utils/ast.js`

- **Purpose:** Determines whether a given AST node is nested inside a `try` block.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `path` | Babel `NodePath` | No | The AST path to check |

- **Return value:** `true` if any ancestor is a `TryStatement`, `false` otherwise.
- **Thrown errors:** None.

### 2.13 `getStageName(path)`

**Source:** `src/task-analysis/utils/ast.js`

- **Purpose:** Walks up the AST from a given node to find the enclosing `ExportNamedDeclaration` and returns its declared identifier name.
- **Parameters:**

| Name | Type | Optional | Semantic Meaning |
|------|------|----------|------------------|
| `path` | Babel `NodePath` | No | The AST path to start from |

- **Return value:** The name of the enclosing exported function (string), or `null` if the node is not inside an exported function.
- **Thrown errors:** None.

---

## 3. Data Models & Structures

### 3.1 TaskAnalysis

The primary output of `analyzeTask`. Represents the complete static analysis of a single task file.

| Field | Type | Optional | Semantic Meaning |
|-------|------|----------|------------------|
| `taskFilePath` | string or null | No | Absolute path to the analyzed task file; null if not provided |
| `stages` | Stage[] | No | Ordered list of pipeline stages |
| `artifacts` | object | No | Container for artifact I/O metadata |
| `artifacts.reads` | ArtifactRead[] | No | Resolved artifact read operations |
| `artifacts.writes` | ArtifactWrite[] | No | Resolved artifact write operations |
| `artifacts.unresolvedReads` | UnresolvedRead[] | No | Artifact reads with dynamic (non-literal) filenames |
| `artifacts.unresolvedWrites` | UnresolvedWrite[] | No | Artifact writes with dynamic (non-literal) filenames |
| `models` | ModelCall[] | No | LLM provider method invocations |

**Lifecycle:** Created by `analyzeTask`, consumed by callers (e.g., the UI's task analysis endpoint, the CLI's analyze-task command). May be persisted via `writeAnalysisFile`.

**Ownership:** Created and owned by this module. Consumers receive it as a plain object.

**Serialization:** When persisted by `writeAnalysisFile`, serialized as JSON with an additional `analyzedAt` ISO-8601 timestamp field. Written to `{pipelinePath}/analysis/{taskName}.analysis.json`.

### 3.2 Stage

Represents a single exported function in a task file -- one step in the task's processing pipeline.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `name` | string | The exported function's identifier name |
| `order` | number | The source line number of the export declaration; used as a proxy for execution order |
| `isAsync` | boolean | Whether the function is declared as `async` |

**Notes:** Stages are sorted ascending by `order`. The `order` value is the line number of the `export` statement, not the function body.

### 3.3 ArtifactRead

Represents a statically resolved `io.readArtifact(...)` call.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `fileName` | string | The artifact filename being read (literal string or evaluated template literal) |
| `stage` | string | Name of the enclosing exported function |
| `required` | boolean | `true` if the call is NOT inside a `try/catch` block; `false` if it is (indicating the read is optional/guarded) |

### 3.4 ArtifactWrite

Represents a statically resolved `io.writeArtifact(...)` call.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `fileName` | string | The artifact filename being written |
| `stage` | string | Name of the enclosing exported function |

### 3.5 UnresolvedRead

Represents an `io.readArtifact(...)` call whose filename argument is a dynamic expression that cannot be statically resolved to a literal string.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `expression` | string | The source code of the dynamic argument expression (generated by Babel) |
| `codeContext` | string | Up to 5 lines of surrounding source code for human/LLM context |
| `stage` | string | Name of the enclosing exported function |
| `required` | boolean | Same semantics as `ArtifactRead.required` |
| `location` | object | `{ line: number, column: number }` -- source position of the argument node |

### 3.6 UnresolvedWrite

Same structure as UnresolvedRead but without the `required` field.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `expression` | string | The source code of the dynamic argument expression |
| `codeContext` | string | Surrounding source context |
| `stage` | string | Name of the enclosing exported function |
| `location` | object | `{ line: number, column: number }` |

### 3.7 ModelCall

Represents an LLM provider method invocation.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `provider` | string | The LLM provider name (e.g., `"deepseek"`, `"openai"`, `"anthropic"`, `"gemini"`) |
| `method` | string | The method name on the provider (e.g., `"chat"`, `"gpt5Mini"`, `"sonnet45"`) |
| `stage` | string | Name of the enclosing exported function |

### 3.8 DeducedSchema (enrichment output)

Returned by `deduceArtifactSchema`.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `schema` | object | A valid JSON Schema Draft-07 object with `$schema`, `type`, `properties`, and `required` |
| `example` | object | Realistic sample data that validates against `schema` |
| `reasoning` | string | Step-by-step explanation of how the LLM determined the schema |

### 3.9 Persisted Schema Files

When written by `writeSchemaFiles`, three files are created in `{pipelinePath}/schemas/`:

| File | Content |
|------|---------|
| `{baseName}.schema.json` | Pure JSON Schema Draft-07 (no extra metadata) |
| `{baseName}.sample.json` | The example data as plain JSON |
| `{baseName}.meta.json` | `{ "source": "llm-deduction", "generatedAt": "<ISO-8601>", "reasoning": "<string>" }` |

Where `{baseName}` is the artifact filename with its extension stripped (e.g., `"output.json"` becomes `"output"`).

### 3.10 Persisted Analysis File

Written by `writeAnalysisFile` to `{pipelinePath}/analysis/{taskName}.analysis.json`. Contains all fields of `TaskAnalysis` plus:

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `analyzedAt` | string | ISO-8601 timestamp of when the analysis was persisted |

### 3.11 ArtifactResolution (enrichment output)

Returned by `resolveArtifactReference`.

| Field | Type | Semantic Meaning |
|-------|------|------------------|
| `resolvedFileName` | string or null | The matched artifact filename, or `null` if no match found or LLM's suggestion was not in the available list |
| `confidence` | number | 0.0 to 1.0; forced to 0 if `resolvedFileName` is null |
| `reasoning` | string | Explanation of the resolution analysis |

---

## 4. Behavioral Contracts

### Preconditions

- `analyzeTask` requires syntactically valid JavaScript/JSX source code (ESM module syntax with optional JSX).
- All `io.readArtifact`, `io.writeArtifact`, and `llm.*.*` calls must appear inside exported functions. If this precondition is violated, the extractors throw.
- `writeAnalysisFile` requires that `analysisData` contains all required fields with correct types. Note that `taskFilePath` must be a non-null, non-empty string (the `analyzeTask` function can return `taskFilePath: null`, but this will fail validation if passed to `writeAnalysisFile`). Validation is performed eagerly before any I/O.
- `writeSchemaFiles` requires that `deducedData` contains `schema` (object), `example` (non-null), and `reasoning` (string).
- `deduceArtifactSchema` requires network access to the DeepSeek LLM API.
- `resolveArtifactReference` requires network access to the DeepSeek LLM API.

### Postconditions

- `analyzeTask` returns a complete `TaskAnalysis` object. Every `io.readArtifact`/`io.writeArtifact`/`llm` call in the source is represented either as a resolved entry or an unresolved entry.
- `extractStages` returns stages sorted ascending by line number.
- `deduceArtifactSchema` guarantees the returned `example` validates against the returned `schema` (validated via Ajv before returning).
- `resolveArtifactReference` guarantees `resolvedFileName` is either `null` or a member of the `availableArtifacts` array. The LLM cannot invent filenames outside the provided list.
- After `writeSchemaFiles` succeeds, three files exist in `{pipelinePath}/schemas/`.
- After `writeAnalysisFile` succeeds, one file exists in `{pipelinePath}/analysis/`.

### Invariants

- Every extracted artifact or LLM call has a non-null `stage` field. The module enforces this by throwing if a call is found outside an exported function.
- The `required` field on `ArtifactRead` and `UnresolvedRead` is the logical inverse of "is inside a try/catch block." The module walks all ancestors to determine this.
- Template literals without expressions are resolved to their literal string value. Template literals with expressions are resolved to the full template string including `${...}` syntax (preserved as-is by Babel's code generator).
- If a readArtifact/writeArtifact argument is neither a string literal nor a template literal, it becomes an unresolved entry (not an error).

### Ordering Guarantees

- `extractStages` sorts its output by source line number (ascending). This gives a deterministic, source-order result.
- No ordering guarantees on the arrays in `artifacts.reads`, `artifacts.writes`, or `models` -- they appear in AST traversal order (depth-first).

### Concurrency Behavior

- `analyzeTask`, `parseTaskSource`, and all extractors are **synchronous** and stateless. They can be called concurrently from multiple threads/fibers without issue.
- `deduceArtifactSchema` contains a module-level `Ajv` instance. It handles potential `$id` conflicts by removing an existing schema with the same `$id` before compiling a new one. However, concurrent calls with schemas sharing the same `$id` could race on add/remove operations.
- `writeSchemaFiles` and `writeAnalysisFile` create directories with `recursive: true` and write files. Concurrent writes to the same output path could produce interleaved content (standard file system race).

---

## 5. State Management

### In-Memory State

- **Ajv instance** (`schema-deducer.js`): A single module-level `Ajv` instance with formats enabled. Persists for the lifetime of the process. Schemas are added and removed dynamically during `deduceArtifactSchema` calls. The `removeSchema` call before `compile` prevents "schema already exists" errors when the same `$id` is encountered across multiple invocations.
- All other functions are stateless. They take inputs and return outputs with no mutable module-level state.

### Persisted State

- **Analysis files:** `{pipelinePath}/analysis/{taskName}.analysis.json` -- written by `writeAnalysisFile`. No journaling, write-ahead logging, or crash recovery. A crash mid-write could produce a truncated or empty file.
- **Schema files:** `{pipelinePath}/schemas/{baseName}.{schema,sample,meta}.json` -- written by `writeSchemaFiles`. Three separate writes; a crash mid-sequence could leave 1 or 2 of 3 files written with the third missing.

### Shared State

None. This module does not read from or write to any state shared with other in-process modules. It writes to disk, which other modules may subsequently read, but there is no in-memory shared state or coordination protocol.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What Is Used | Nature | Coupling |
|--------|-------------|--------|----------|
| `src/llm/index.js` | `chat` function | Runtime import (ESM) | Moderate. Used by `schema-deducer.js` and `artifact-resolver.js` for LLM completions. The call signature (`provider`, `model`, `messages`, `temperature`, `responseFormat`) is the coupling surface. Could be replaced with any function matching that interface. |

### 6.2 External Dependencies

| Package | What It Provides | How It's Used | Replaceability |
|---------|-----------------|---------------|----------------|
| `@babel/parser` | JavaScript/JSX parser | Parses source code into an AST in `parser.js`. Used with `sourceType: "module"` and `plugins: ["jsx"]`. | Localized to `parser.js`. Could be replaced with any parser that produces a compatible AST (e.g., `acorn` with JSX plugin), though downstream traversal/type-checking code assumes Babel AST shape. |
| `@babel/traverse` | AST traversal | Used in all three extractors to walk the AST and visit specific node types (`ExportNamedDeclaration`, `CallExpression`). Imported with a default/named fallback pattern for CJS/ESM interop. | Deeply used across extractors and utils. Replacement would require rewriting all visitor logic. |
| `@babel/generator` | AST-to-source-code generation | Used in `artifacts.js` to convert unresolvable AST nodes back to source code strings (for `expression` fields and template literal rendering). Same CJS/ESM interop pattern. | Used in two places in `artifacts.js`. Moderately localized. |
| `@babel/types` | AST node type predicates and constructors | Used in `artifacts.js` and `llm-calls.js` for type checks (`isMemberExpression`, `isIdentifier`, `isStringLiteral`, `isTemplateLiteral`, `isObjectPattern`, `isObjectProperty`, `isVariableDeclarator`). | Pervasive in extractor logic. Tightly coupled to the Babel AST type system. |
| `ajv` | JSON Schema validator | Used in `schema-deducer.js` to validate that the LLM-generated example conforms to the LLM-generated schema. | Localized to `schema-deducer.js`. Any JSON Schema Draft-07 validator could substitute. |
| `ajv-formats` | JSON Schema format validators | Adds string format validation (e.g., `"email"`, `"uri"`) to Ajv. | Localized, tied to Ajv. |

### 6.3 System-Level Dependencies

- **File system:** `writeAnalysisFile` and `writeSchemaFiles` use `node:fs/promises` for async file/directory operations. They assume the pipeline directory path is writable and that the process has permission to create subdirectories.
- **`node:path`:** Used for path joining and parsing (extracting file stems).
- **Network:** `deduceArtifactSchema` and `resolveArtifactReference` make LLM API calls via the internal `chat` function, which requires network access to the configured LLM endpoint.
- **No environment variables** are directly read by this module. Configuration (LLM provider, model) is hardcoded in the enrichers.

---

## 7. Side Effects & I/O

### File System

| Operation | Function | Details |
|-----------|----------|---------|
| Directory creation | `writeSchemaFiles` | Creates `{pipelinePath}/schemas/` with `recursive: true` |
| Directory creation | `writeAnalysisFile` | Creates `{pipelinePath}/analysis/` with `recursive: true` |
| File write | `writeSchemaFiles` | Writes three files: `*.schema.json`, `*.sample.json`, `*.meta.json` |
| File write | `writeAnalysisFile` | Writes one file: `*.analysis.json` |

All file operations are asynchronous. Errors propagate as rejected promises.

### Network

| Operation | Function | Details |
|-----------|----------|---------|
| LLM chat completion | `deduceArtifactSchema` | Calls `chat()` with provider `"deepseek"`, model `"deepseek-chat"`, temperature `0`, JSON response format |
| LLM chat completion | `resolveArtifactReference` | Calls `chat()` with provider `"deepseek"`, temperature `0`, JSON response format |

Both are asynchronous. `deduceArtifactSchema` propagates errors; `resolveArtifactReference` catches all errors and returns a fallback result.

### Logging & Observability

None identified. This module performs no logging.

### Timing & Scheduling

None identified. No timers, intervals, or polling.

### Process Management

None identified. No child processes, signals, or exit code handling.

---

## 8. Error Handling & Failure Modes

### Parse Errors (`parseTaskSource`)

- **Category:** Syntax/validation error.
- **Propagation:** Throws an `Error` with a human-readable message including the syntax error location. The original Babel parser error is preserved as `error.cause`.
- **Recovery:** None -- the caller must provide valid source code.

### Extraction Errors (all extractors)

- **Category:** Structural invariant violation.
- **Propagation:** Throws an `Error` when an `io.readArtifact`, `io.writeArtifact`, or `llm.*.*` call is found outside an exported function. The error message includes the source location (line:column).
- **Recovery:** None -- this indicates the task source code violates the expected structure (all I/O and LLM calls must be inside exported stages).

### Schema Deduction Errors (`deduceArtifactSchema`)

- **Category:** External service / validation error.
- **Propagation:** Throws in the following scenarios:
  1. The `chat` response itself is missing or not an object.
  2. `response.content` is missing or not an object.
  3. The parsed content lacks required properties (`schema`, `example`, `reasoning`) or they have wrong types.
  4. The generated example fails Ajv validation against the generated schema.
- **Recovery:** None at this level. The caller must decide whether to retry or skip.

### Schema Writer Errors (`writeSchemaFiles`)

- **Category:** Validation / I/O error.
- **Propagation:** Throws if `deducedData` has invalid structure. Propagates file system errors.
- **Partial failure:** The three files are written sequentially. A failure after 1 or 2 writes leaves a partial set on disk with no cleanup or rollback.

### Analysis Writer Errors (`writeAnalysisFile`)

- **Category:** Validation / I/O error.
- **Propagation:** Eagerly validates all required fields of `analysisData` before writing. Propagates file system errors.
- **Partial failure:** Single file write; a mid-write failure could leave a truncated file.

### Artifact Resolution Errors (`resolveArtifactReference`)

- **Category:** External service error.
- **Propagation:** Never throws. Uses a blanket `catch` that returns `{ resolvedFileName: null, confidence: 0, reasoning: "Failed to analyze artifact reference" }`.
- **Recovery:** Graceful degradation -- the artifact remains unresolved but the system continues.

### User/Operator Visibility

Errors in extractors and the parser will propagate up to whatever orchestrates the analysis (e.g., the CLI `analyze-task` command or the UI's task analysis endpoint), which is responsible for surfacing them to the user.

---

## 9. Integration Points & Data Flow

### Upstream (Who calls this module)

- **CLI `analyze-task` command** (`src/cli/analyze-task.js`): Invokes `analyzeTask` on task source files and uses `writeAnalysisFile` to persist results.
- **UI task analysis endpoint** (`src/ui/endpoints/task-analysis-endpoint.js`): Invokes `analyzeTask` to provide real-time analysis data to the dashboard.
- **Schema deduction** is likely invoked by the pipeline analysis workflow to populate schema files for each artifact.
- **Artifact resolution** is likely invoked after initial analysis to fill in unresolved references.

### Downstream (What this module calls)

- **`src/llm/index.js`** (`chat` function): Used by `schema-deducer.js` and `artifact-resolver.js` for LLM completions.
- **File system**: Schema files and analysis files are consumed by the UI server (read back for display) and potentially by the pipeline runner (schema validation of artifacts).

### Data Transformation Flow

1. **Input:** Raw JavaScript/JSX source code (string).
2. **Parse:** `parseTaskSource` transforms source text into a Babel AST.
3. **Extract:** Three extractors independently traverse the AST:
   - `extractStages` produces `Stage[]`
   - `extractArtifactReads`/`extractArtifactWrites` produce resolved and unresolved artifact records
   - `extractLLMCalls` produces `ModelCall[]`
4. **Compose:** `analyzeTask` assembles these into a single `TaskAnalysis` object.
5. **Enrich (optional):**
   - `resolveArtifactReference` attempts to match unresolved artifacts to known filenames via LLM.
   - `deduceArtifactSchema` infers JSON schemas for artifacts via LLM.
6. **Persist (optional):**
   - `writeAnalysisFile` serializes `TaskAnalysis` to JSON on disk.
   - `writeSchemaFiles` writes schema, sample, and metadata files.

### Control Flow for Primary Use Case (`analyzeTask`)

```
analyzeTask(code, taskFilePath)
  |
  +-- parseTaskSource(code)          -> AST (or throw on syntax error)
  |
  +-- extractStages(ast)             -> Stage[]  (sorted by line number)
  |
  +-- extractArtifactReads(ast, code) -> { reads, unresolvedReads }
  |
  +-- extractArtifactWrites(ast, code) -> { writes, unresolvedWrites }
  |
  +-- extractLLMCalls(ast)           -> ModelCall[]
  |
  +-- Compose and return TaskAnalysis
```

All extractors operate on the same AST independently. No extractor depends on another's output.

---

## 10. Edge Cases & Implicit Behavior

### Default Values

- `taskFilePath` defaults to `null` if not provided to `analyzeTask`.
- Stage `order` defaults to `0` if the AST node lacks location information (`loc?.start.line ?? 0`).
- Stage `isAsync` defaults to `false` if the `async` property is missing from the AST node (`declaration.async ?? false`).

### Template Literal Handling

- Template literals **without** expressions (e.g., `` `file.json` ``) are resolved to their literal string value by joining cooked quasis.
- Template literals **with** expressions (e.g., `` `file-${name}.json` ``) are preserved in source-code form by using Babel's code generator and stripping backticks. This means the `fileName` field can contain `${...}` syntax. Despite the field name suggesting a resolved filename, it may contain dynamic expressions. These are still placed in the `reads`/`writes` arrays (not `unresolvedReads`/`unresolvedWrites`), which could be surprising.

### Babel CJS/ESM Interop

- `@babel/traverse` and `@babel/generator` are imported with a dual-access pattern: `const traverse = _traverse.default ?? _traverse`. This handles the case where the package is loaded as a CJS module (where the function is on `.default`) or as ESM (where it's the module itself).

### Destructured LLM Call Detection

- The LLM call extractor handles two destructuring patterns:
  1. **Variable destructuring:** `const { deepseek } = llm; deepseek.chat(...)` -- detected via scope binding analysis on `VariableDeclarator` nodes.
  2. **Parameter destructuring:** `({ llm: { deepseek } }) => { deepseek.chat(...) }` -- detected by inspecting `ObjectPattern` parameter bindings for a nested `llm` property. Supports both shorthand (`{ provider }`) and renamed (`{ provider: alias }`) destructuring.
- This scope-based analysis prevents false positives from same-named identifiers in different scopes.

### Hardcoded LLM Provider

- Both `deduceArtifactSchema` and `resolveArtifactReference` hardcode `provider: "deepseek"` in their LLM calls. `deduceArtifactSchema` additionally hardcodes `model: "deepseek-chat"`. There is no configuration mechanism to change the LLM provider or model used for enrichment.

### Ajv Schema ID Conflict Handling

- `deduceArtifactSchema` checks for an existing schema with the same `$id` in the Ajv instance and removes it before compiling. This prevents "schema already exists" errors across repeated calls. However, this is a mutation of shared module-level state.

### `extractStages` First Declarator Only

- When processing `export const name = ...` (variable declaration form), `extractStages` only examines `declaration.declarations[0]` -- the first declarator. If a single export statement declares multiple variables (e.g., `export const a = () => {}, b = () => {}`), only the first would be detected as a stage.

### Artifact Resolver Response Sanitization

- `resolveArtifactReference` performs strict sanitization of the LLM's response: if `resolvedFileName` is not a member of the `availableArtifacts` array, it is forced to `null` and `confidence` is forced to `0`. This prevents the LLM from hallucinating artifact names.
- The LLM response is parsed with `JSON.parse` (not structured output/`responseFormat: { type: "json_object" }`). Note the inconsistency: `responseFormat` is passed as the string `"json_object"` rather than the object `{ type: "json_object" }` used in `deduceArtifactSchema`.

---

## 11. Open Questions & Ambiguities

1. **Template literals with expressions in resolved arrays:** When `extractFileName` encounters a template literal with expressions (e.g., `` `file-${name}.json` ``), it returns the source text (with `${...}` syntax) and the artifact is placed in the resolved `reads`/`writes` array rather than the `unresolvedReads`/`unresolvedWrites` array. It is unclear whether this is intentional (treating the template as a pattern) or if such entries should be considered unresolved.

2. **`responseFormat` inconsistency in artifact resolver:** `deduceArtifactSchema` passes `responseFormat: { type: "json_object" }` (an object), while `resolveArtifactReference` passes `responseFormat: "json_object"` (a string). The artifact resolver also calls `JSON.parse(response.content)` on the result, suggesting the response comes back as a raw string rather than a parsed object. This inconsistency may indicate different behavior depending on how the `chat` function handles the two formats, or it may be a bug.

3. **No test coverage information available:** The analysis prompt asks to reference existing tests. No test files were provided in the source file list, so test coverage for this module's behavioral contracts cannot be assessed.

4. **Enrichment orchestration is external:** The module provides `deduceArtifactSchema`, `resolveArtifactReference`, `writeSchemaFiles`, and `writeAnalysisFile` as separate functions, but there is no internal orchestration function that chains them together (e.g., "analyze, then resolve unresolved artifacts, then deduce schemas, then persist everything"). The caller is responsible for this workflow. It is unclear whether there is an intended canonical order of operations.

5. **No concurrency protection on Ajv instance:** The module-level `Ajv` instance in `schema-deducer.js` is mutated (add/remove schema) during each call. Concurrent `deduceArtifactSchema` invocations with schemas sharing the same `$id` could race. It is unclear whether this is a practical concern given the system's execution model.

6. **`extractStages` only processes first variable declarator:** For `export const` declarations, only `declarations[0]` is examined. This appears to be an intentional simplification (multi-declarator exports are uncommon), but it means `export const a = () => {}, b = () => {}` would only capture `a`.

7. **Hardcoded DeepSeek provider/model:** Both LLM enrichment functions hardcode the provider as `"deepseek"` (and `deduceArtifactSchema` hardcodes the model as `"deepseek-chat"`). There is no documented rationale for why DeepSeek was chosen over other available providers, and no configuration path to change it.
