# Implementation Specification: `task-analysis`

**Analysis source:** `docs/specs/analysis/task-analysis.md`

---

## 1. Qualifications

- TypeScript strict mode (discriminated unions, `import type`, template literal types)
- Babel AST parsing (`@babel/parser`) with JSX and ESM source type configuration
- Babel AST traversal (`@babel/traverse`) with visitor pattern and `NodePath` scope analysis
- Babel AST code generation (`@babel/generator`) for converting AST nodes back to source text
- Babel type predicates (`@babel/types`) for node type narrowing (`isMemberExpression`, `isStringLiteral`, `isTemplateLiteral`, etc.)
- JSON Schema Draft-07 validation with Ajv
- LLM chat completion integration (structured JSON prompts, response parsing and validation)
- Bun file I/O (`Bun.file`, `Bun.write`) for persisting analysis and schema files
- AST scope-binding analysis for destructured identifier resolution (LLM call detection)

---

## 2. Problem Statement

The system requires a static analysis library that extracts structured metadata (stages, artifact I/O, LLM calls) from pipeline task source code, with optional LLM-powered enrichment for schema deduction and artifact reference resolution. The existing JS implementation provides this via Babel AST parsing and traversal with per-concern extractors and separate enrichment functions. This spec defines the TypeScript replacement.

---

## 3. Goal

A set of TypeScript modules under `src/task-analysis/` that provide identical behavioral contracts to the analyzed JS module — parsing task source code into Babel ASTs, extracting stages, artifact reads/writes, and LLM calls, enriching results via LLM services, and persisting analysis and schema files to disk — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/task-analysis/types.ts` | All shared types: `TaskAnalysis`, `Stage`, `ArtifactRead`, `ArtifactWrite`, `UnresolvedRead`, `UnresolvedWrite`, `ModelCall`, `DeducedSchema`, `ArtifactResolution`, `SourceLocation`. |
| `src/task-analysis/parser.ts` | `parseTaskSource` — parses JS/JSX source code into a Babel AST. |
| `src/task-analysis/utils/ast.ts` | AST utility functions: `isInsideTryCatch`, `getStageName`. |
| `src/task-analysis/extractors/stages.ts` | `extractStages` — extracts exported function declarations as pipeline stages. |
| `src/task-analysis/extractors/artifacts.ts` | `extractArtifactReads`, `extractArtifactWrites`, `extractCodeContext` — extracts `io.readArtifact`/`io.writeArtifact` calls. |
| `src/task-analysis/extractors/llm-calls.ts` | `extractLLMCalls` — extracts LLM provider method invocations with destructuring support. |
| `src/task-analysis/enrichers/schema-deducer.ts` | `deduceArtifactSchema` — uses LLM to infer JSON Schema for artifacts. |
| `src/task-analysis/enrichers/artifact-resolver.ts` | `resolveArtifactReference` — uses LLM to resolve dynamic artifact references. |
| `src/task-analysis/enrichers/schema-writer.ts` | `writeSchemaFiles` — persists deduced schema, sample, and metadata files to disk. |
| `src/task-analysis/enrichers/analysis-writer.ts` | `writeAnalysisFile` — persists `TaskAnalysis` to disk as JSON. |
| `src/task-analysis/index.ts` | `analyzeTask` — main entry point composing parser + all extractors. Re-exports all public functions. |

### Key types and interfaces

```typescript
// ── src/task-analysis/types.ts ──

import type { File as BabelFile } from "@babel/types";
import type { NodePath } from "@babel/traverse";

/** Source location in the original file. */
interface SourceLocation {
  line: number;
  column: number;
}

/** A single exported function in a task file — one pipeline stage. */
interface Stage {
  name: string;
  order: number;
  isAsync: boolean;
}

/** A statically resolved io.readArtifact() call. */
interface ArtifactRead {
  fileName: string;
  stage: string;
  required: boolean;
}

/** A statically resolved io.writeArtifact() call. */
interface ArtifactWrite {
  fileName: string;
  stage: string;
}

/** An io.readArtifact() call with a dynamic filename that cannot be statically resolved. */
interface UnresolvedRead {
  expression: string;
  codeContext: string;
  stage: string;
  required: boolean;
  location: SourceLocation;
}

/** An io.writeArtifact() call with a dynamic filename that cannot be statically resolved. */
interface UnresolvedWrite {
  expression: string;
  codeContext: string;
  stage: string;
  location: SourceLocation;
}

/** An LLM provider method invocation. */
interface ModelCall {
  provider: string;
  method: string;
  stage: string;
}

/** Container for all artifact I/O metadata. */
interface ArtifactData {
  reads: ArtifactRead[];
  writes: ArtifactWrite[];
  unresolvedReads: UnresolvedRead[];
  unresolvedWrites: UnresolvedWrite[];
}

/** Complete static analysis result for a single task file. */
interface TaskAnalysis {
  taskFilePath: string | null;
  stages: Stage[];
  artifacts: ArtifactData;
  models: ModelCall[];
}

/** Persisted analysis file includes a timestamp. */
interface PersistedTaskAnalysis extends TaskAnalysis {
  analyzedAt: string;
}

/** Result of LLM-powered schema deduction. */
interface DeducedSchema {
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
  reasoning: string;
}

/** Result of LLM-powered artifact reference resolution. */
interface ArtifactResolution {
  resolvedFileName: string | null;
  confidence: number;
  reasoning: string;
}

/** Descriptor for an artifact to deduce schema for. */
interface ArtifactDescriptor {
  fileName: string;
  stage: string;
}

/** Descriptor for an unresolved artifact to resolve. */
interface UnresolvedArtifactDescriptor {
  expression: string;
  codeContext: string;
  stage: string;
}
```

### Bun-specific design decisions

| Area | Change from JS Original | Rationale |
|------|------------------------|-----------|
| File I/O | Replace `node:fs/promises` (`mkdir`, `writeFile`) with `Bun.write()` for file writing and `import { mkdir } from "node:fs/promises"` for directory creation | `Bun.write` is the native file write API. Bun has no native `mkdir` equivalent, but supports `node:fs/promises`. |
| Path handling | Continue using `node:path` for `path.join` and `path.parse` | Bun natively supports `node:path`. No migration needed. |
| Babel CJS/ESM interop | Remove the `_traverse.default ?? _traverse` dual-access pattern | In Bun with ESM, Babel packages import cleanly. The interop hack is unnecessary. A smoke test (acceptance criterion 5a) validates this assumption. If Bun's import resolution changes, re-add explicit `.default` access. |

### Dependency map

**Internal `src/` imports:**

| This module imports from | What |
|--------------------------|------|
| `src/llm/index.ts` | `chat` function (used by `schema-deducer.ts` and `artifact-resolver.ts`) |

**External packages:**

| Package | Used by | Purpose |
|---------|---------|---------|
| `@babel/parser` | `parser.ts` | Parses JS/JSX source code into AST |
| `@babel/traverse` | `extractors/stages.ts`, `extractors/artifacts.ts`, `extractors/llm-calls.ts`, `utils/ast.ts` | AST traversal with visitor pattern |
| `@babel/generator` | `extractors/artifacts.ts` | Converts AST nodes back to source strings for unresolved expressions and template literals |
| `@babel/types` | `extractors/artifacts.ts`, `extractors/llm-calls.ts` | AST node type predicates |
| `ajv` | `enrichers/schema-deducer.ts` | JSON Schema Draft-07 validation |
| `ajv-formats` | `enrichers/schema-deducer.ts` | String format validators for Ajv |

---

## 5. Acceptance Criteria

### Core behavior

1. `analyzeTask(code)` returns a `TaskAnalysis` object with `taskFilePath`, `stages`, `artifacts`, and `models` fields.
2. `analyzeTask(code, taskFilePath)` stores the provided file path in the result's `taskFilePath`.
3. `analyzeTask(code)` with no `taskFilePath` argument sets `taskFilePath` to `null`.
4. Every `io.readArtifact` and `io.writeArtifact` call in the source is represented either as a resolved entry or an unresolved entry — nothing is silently dropped. Every LLM call matching the three supported syntax forms (direct `llm.provider.method()`, variable-destructured, parameter-destructured per criteria 24–26) is represented as a `ModelCall` — other indirect LLM access patterns (e.g., passing `llm` to a helper function, dynamic property access) are not detected and are outside the scope of static extraction.

### Parsing

5. `parseTaskSource` parses valid ESM JavaScript with JSX into a Babel `File` AST node.
5a. `import traverse from "@babel/traverse"` and `import generate from "@babel/generator"` resolve to callable functions under Bun's ESM loader without `.default` unwrapping. A dedicated smoke test imports both and asserts `typeof traverse === "function"` and `typeof generate === "function"`.
6. `parseTaskSource` throws an `Error` with syntax error location (line/column) and the original error as `cause` on invalid source code.

### Stage extraction

7. `extractStages` returns an array of `Stage` objects sorted ascending by `order` (source line number).
8. `extractStages` detects exported function declarations (`export function`), exported arrow functions (`export const`), and exported async variants.
9. `extractStages` returns an empty array when no exported functions are found.
10. Stage `order` defaults to `0` when AST location information is missing.
11. Stage `isAsync` defaults to `false` when the `async` property is missing.
12. For `export const` declarations, only the first declarator is examined.

### Artifact extraction

13. `extractArtifactReads` returns `{ reads, unresolvedReads }` — resolved reads have a literal `fileName`; unresolved reads have a dynamic `expression`.
14. `extractArtifactWrites` returns `{ writes, unresolvedWrites }` — same structure as reads.
15. String literal arguments to `io.readArtifact`/`io.writeArtifact` produce resolved entries with the literal string as `fileName`.
16. Template literals without expressions are resolved to their literal string value.
17. Template literals with expressions are resolved to their source-code form (with `${...}` syntax) and placed in the resolved arrays (not unresolved).
18. Non-literal, non-template arguments produce unresolved entries with `expression`, `codeContext`, `stage`, and `location`.
19. The `required` field on `ArtifactRead` and `UnresolvedRead` is `true` when the call is NOT inside a `try/catch`, `false` when it IS.
20. `extractArtifactReads` and `extractArtifactWrites` throw if an artifact call is found outside an exported function.
21. `extractCodeContext` returns up to 5 lines of surrounding source code (2 before, 2 after) for a given AST node.
22. `extractCodeContext` returns an empty string if source code or location information is unavailable.

### LLM call extraction

23. `extractLLMCalls` returns an array of `ModelCall` objects with `provider`, `method`, and `stage`.
24. `extractLLMCalls` detects direct `llm.provider.method()` call patterns.
25. `extractLLMCalls` detects variable-destructured patterns: `const { provider } = llm; provider.method()`.
26. `extractLLMCalls` detects parameter-destructured patterns: `({ llm: { provider } }) => { provider.method() }`.
27. `extractLLMCalls` throws if an LLM call is found outside an exported function.
28. Destructured LLM detection uses scope-binding analysis to prevent false positives from same-named identifiers in different scopes.

### AST utilities

29. `isInsideTryCatch(path)` returns `true` if any ancestor is a `TryStatement`, `false` otherwise.
30. `getStageName(path)` returns the identifier name of the enclosing `ExportNamedDeclaration`, or `null` if not inside one.

### Schema deduction (enrichment)

31. `deduceArtifactSchema` returns `{ schema, example, reasoning }` where `schema` is a valid JSON Schema Draft-07 object.
32. `deduceArtifactSchema` validates the generated example against the generated schema using Ajv before returning.
33. `deduceArtifactSchema` throws if the LLM response is missing, malformed, or the example fails schema validation.
34. The Ajv instance handles `$id` conflicts by removing existing schemas before compiling.

### Artifact resolution (enrichment)

35. `resolveArtifactReference` returns `{ resolvedFileName, confidence, reasoning }`.
36. `confidence` is always a finite number in `[0, 1]`. Non-finite values (`NaN`, `Infinity`) are forced to `0`; out-of-range values are clamped. If the LLM's suggested filename is not in `availableArtifacts`, `resolvedFileName` is forced to `null` and `confidence` to `0`.
37. `resolveArtifactReference` never throws — catches all errors and returns `{ resolvedFileName: null, confidence: 0, reasoning: "Failed to analyze artifact reference" }`.
37a. Both `deduceArtifactSchema` and `resolveArtifactReference` treat `chat()` response `content` as a pre-parsed object (the gateway normalizes JSON-mode responses). If `content` is unexpectedly a string or null, the call fails with a clear assertion error (caught by the resolver's blanket catch, propagated by the deducer).

### Persistence

38. `writeAnalysisFile` validates all required fields of `analysisData` (including `taskFilePath` is non-null non-empty string, `stages` and `models` are arrays, `artifacts` has `reads` and `writes` arrays) before any I/O.
39. `writeAnalysisFile` creates `{pipelinePath}/analysis/` directory with `recursive: true` and writes `{taskName}.analysis.json` with the analysis data plus `analyzedAt` ISO-8601 timestamp.
40. `writeAnalysisFile` throws on invalid `analysisData` or file system errors.
41. `writeSchemaFiles` validates `deducedData` has `schema` (non-null plain object), `example` (non-null plain object — arrays and primitives rejected), and `reasoning` (string) before any I/O.
42. `writeSchemaFiles` creates `{pipelinePath}/schemas/` directory and writes three files: `{baseName}.schema.json`, `{baseName}.sample.json`, `{baseName}.meta.json`.
43. The `{baseName}` is derived by stripping the file extension from the artifact filename.
44. The meta file contains `{ source: "llm-deduction", generatedAt: "<ISO-8601>", reasoning: "<string>" }`.

### Error handling

45. Parse errors include syntax error location and preserve the original error as `cause`.
46. Extraction errors for calls outside exported functions include source location (line:column) in the error message.
47. Schema deduction errors propagate to the caller (no internal catch).
48. Analysis writer eagerly validates before performing any I/O.

---

## 6. Notes

### Design trade-offs

- **Module-level Ajv instance:** The JS original uses a single module-level `Ajv` instance with dynamic add/remove of schemas. The TS version preserves this pattern since `deduceArtifactSchema` is not expected to be called concurrently in practice. The `removeSchema` before `compile` pattern is retained. If concurrency becomes a concern, the Ajv instance could be created per-call, but this adds GC overhead for the common sequential case.
- **Babel interop pattern removal:** The JS original uses `_traverse.default ?? _traverse` to handle CJS/ESM dual-loading of Babel packages. In the TS/Bun environment with proper ESM imports, this is unnecessary. Standard `import traverse from "@babel/traverse"` should work. Acceptance criterion 5a and a dedicated smoke test validate this assumption under Bun. If Bun's Babel interop requires `.default`, a single-line adjustment handles it.
- **Template literals with expressions in resolved arrays:** The analysis flagged this as ambiguous (Open Question 1). The TS version preserves the JS behavior: template literals with expressions go into the resolved arrays with `${...}` syntax in the `fileName` field. This matches existing consumer expectations and avoids breaking downstream behavior.
- **Hardcoded LLM provider:** Both enrichment functions hardcode `provider: "deepseek"` and `model: "deepseek-chat"`. The TS version preserves this to maintain behavioral parity. Making it configurable is a future enhancement.

### Open questions from analysis

- **`responseFormat` inconsistency (Open Question 2):** `deduceArtifactSchema` passes `responseFormat: { type: "json_object" }` (object) while `resolveArtifactReference` passes `responseFormat: "json_object"` (string). The TS version normalizes both to `{ type: "json_object" }` for consistency, since the `chat` function in the providers module handles both forms.
- **Template literals in resolved arrays (Open Question 1):** Preserved as-is per the design trade-offs section above.
- **No concurrency protection on Ajv (Open Question 5):** Accepted risk — sequential usage is the expected pattern.
- **First declarator only (Open Question 6):** Preserved. Multi-declarator exports are extremely rare in practice.

### Migration-specific concerns

- **Behaviors that change intentionally:**
  - Babel CJS/ESM interop hack removed — clean ESM imports.
  - `responseFormat` in `resolveArtifactReference` normalized to object form `{ type: "json_object" }` instead of the string `"json_object"`.
  - File I/O uses `Bun.write` instead of `node:fs/promises.writeFile`.
- **Behaviors that must remain identical:**
  - All extractor logic: stage detection, artifact extraction (including template literal handling), LLM call detection (including both destructuring patterns).
  - `analyzeTask` composition: parse → extractStages → extractArtifactReads → extractArtifactWrites → extractLLMCalls → assemble.
  - Error throwing conditions and messages for calls outside exported functions.
  - `writeAnalysisFile` validation logic (taskFilePath non-null, arrays, etc.).
  - `writeSchemaFiles` three-file write pattern and validation.
  - `deduceArtifactSchema` Ajv validation of example against schema.
  - `resolveArtifactReference` sanitization — forcing `null`/`0` when filename not in available list.
  - `resolveArtifactReference` blanket catch returning fallback result.

### Dependencies on other modules

- **`src/llm/index.ts`** must be available — enrichers import `chat`. If not yet migrated, stub with a type-compatible shim:
  ```typescript
  export async function chat(options: {
    provider: string;
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    responseFormat?: { type: string } | string;
  }): Promise<{ content: unknown }> {
    throw new Error("LLM module not yet available");
  }
  ```

### Performance considerations

- AST parsing and traversal are CPU-bound and synchronous. Bun's faster JS engine may provide marginal speedups over Node.js.
- `Bun.write` is async and efficient for the small JSON files produced by the writers.
- The enrichment functions are network-bound (LLM API calls). No Bun-specific optimization applies.

---

## 7. Implementation Steps

### Step 1: Create task-analysis types

**What to do:** Create `src/task-analysis/types.ts` with all interfaces and types defined in Section 4: `SourceLocation`, `Stage`, `ArtifactRead`, `ArtifactWrite`, `UnresolvedRead`, `UnresolvedWrite`, `ModelCall`, `ArtifactData`, `TaskAnalysis`, `PersistedTaskAnalysis`, `DeducedSchema`, `ArtifactResolution`, `ArtifactDescriptor`, `UnresolvedArtifactDescriptor`.

**Why:** All subsequent task-analysis modules import from this file. Types must exist first (ordering principle).

**Type signatures:**

```typescript
export interface SourceLocation {
  line: number;
  column: number;
}

export interface Stage {
  name: string;
  order: number;
  isAsync: boolean;
}

export interface ArtifactRead {
  fileName: string;
  stage: string;
  required: boolean;
}

export interface ArtifactWrite {
  fileName: string;
  stage: string;
}

export interface UnresolvedRead {
  expression: string;
  codeContext: string;
  stage: string;
  required: boolean;
  location: SourceLocation;
}

export interface UnresolvedWrite {
  expression: string;
  codeContext: string;
  stage: string;
  location: SourceLocation;
}

export interface ModelCall {
  provider: string;
  method: string;
  stage: string;
}

export interface ArtifactData {
  reads: ArtifactRead[];
  writes: ArtifactWrite[];
  unresolvedReads: UnresolvedRead[];
  unresolvedWrites: UnresolvedWrite[];
}

export interface TaskAnalysis {
  taskFilePath: string | null;
  stages: Stage[];
  artifacts: ArtifactData;
  models: ModelCall[];
}

export interface PersistedTaskAnalysis extends TaskAnalysis {
  analyzedAt: string;
}

export interface DeducedSchema {
  schema: Record<string, unknown>;
  example: unknown;
  reasoning: string;
}

export interface ArtifactResolution {
  resolvedFileName: string | null;
  confidence: number;
  reasoning: string;
}

export interface ArtifactDescriptor {
  fileName: string;
  stage: string;
}

export interface UnresolvedArtifactDescriptor {
  expression: string;
  codeContext: string;
  stage: string;
}
```

**Test:** `src/task-analysis/__tests__/types.test.ts` — Verify that all interfaces can be imported and used to construct objects satisfying each shape. Verify `TaskAnalysis` with `taskFilePath: null` is valid. Verify `ArtifactData` requires all four arrays.

---

### Step 2: Create AST utility functions

**What to do:** Create `src/task-analysis/utils/ast.ts` exporting `isInsideTryCatch(path: NodePath): boolean` and `getStageName(path: NodePath): string | null`.

**Why:** These are used by all three extractors. They must exist before the extractors are built. Satisfies acceptance criteria 29, 30.

**Type signatures:**

```typescript
import type { NodePath } from "@babel/traverse";

export function isInsideTryCatch(path: NodePath): boolean
export function getStageName(path: NodePath): string | null
```

**Implementation details:**
- `isInsideTryCatch`: Walk up `path`'s ancestors. Return `true` if any ancestor node is a `TryStatement` (specifically, if the path is inside the `block` of a `TryStatement`). Return `false` if no such ancestor exists.
- `getStageName`: Walk up `path`'s ancestors looking for an `ExportNamedDeclaration`. If found, extract the declared function/variable name from its `declaration` property. For `FunctionDeclaration`, return `declaration.id.name`. For `VariableDeclaration`, return `declaration.declarations[0].id.name`. Return `null` if no `ExportNamedDeclaration` ancestor is found.

**Test:** `src/task-analysis/__tests__/utils-ast.test.ts`
- Parse source code containing `export async function myStage() { try { io.readArtifact("x") } catch(e) {} }` with `@babel/parser`. Traverse to the `io.readArtifact` call expression. Verify `isInsideTryCatch` returns `true` and `getStageName` returns `"myStage"`.
- Parse source with a function call outside any exported function. Verify `getStageName` returns `null`.
- Parse source with a function call outside a try/catch. Verify `isInsideTryCatch` returns `false`.

---

### Step 3: Implement the parser

**What to do:** Create `src/task-analysis/parser.ts` exporting `parseTaskSource(code: string): BabelFile`.

**Why:** The parser transforms raw source code into an AST consumed by all extractors. Satisfies acceptance criteria 5, 6, 45.

**Type signatures:**

```typescript
import type { File as BabelFile } from "@babel/types";

export function parseTaskSource(code: string): BabelFile
```

**Implementation details:**
- Call `@babel/parser`'s `parse(code, { sourceType: "module", plugins: ["jsx"] })`.
- On success, return the `File` AST node.
- On error, catch the Babel parse error and throw a new `Error` with a message including the syntax error location (line/column) and the original error set as `cause`.

**Test:** `src/task-analysis/__tests__/parser.test.ts`
- Parse valid ESM code: `export function foo() {}`. Verify result is a `File` node with a body.
- Parse valid JSX code: `export function Comp() { return <div /> }`. Verify it parses without error.
- Parse invalid code: `export function {`. Verify it throws an `Error` with line/column info and `cause` set to the original error.
- **Babel import interop smoke test:** `import traverse from "@babel/traverse"` — assert `typeof traverse === "function"`. `import generate from "@babel/generator"` — assert `typeof generate === "function"`. This validates the CJS/ESM interop assumption (criterion 5a) and catches regressions if Bun's import resolution changes.

---

### Step 4: Implement stage extractor

**What to do:** Create `src/task-analysis/extractors/stages.ts` exporting `extractStages(ast: BabelFile): Stage[]`.

**Why:** Stage extraction is the first data extraction step. Satisfies acceptance criteria 7–12.

**Type signatures:**

```typescript
import type { File as BabelFile } from "@babel/types";
import type { Stage } from "../types.ts";

export function extractStages(ast: BabelFile): Stage[]
```

**Implementation details:**
- Use `@babel/traverse` to visit `ExportNamedDeclaration` nodes.
- For each, check if the `declaration` is a `FunctionDeclaration` or a `VariableDeclaration` whose first declarator's `init` is an `ArrowFunctionExpression` or `FunctionExpression`.
- Extract `name` from the function/variable identifier.
- Extract `order` from `node.loc?.start.line ?? 0`.
- Extract `isAsync` from `declaration.async ?? false` (for function declarations) or `declaration.declarations[0].init.async ?? false` (for arrow/function expressions).
- Collect into an array, sort ascending by `order`, and return.
- For `VariableDeclaration`, only examine `declarations[0]`.

**Test:** `src/task-analysis/__tests__/extractors-stages.test.ts`
- Parse source with `export async function ingestion() {}` and `export function parsing() {}`. Verify `extractStages` returns two stages with correct `name`, `isAsync`, and ascending `order`.
- Parse source with `export const refine = async () => {}`. Verify it detects `refine` as an async stage.
- Parse source with no exports. Verify empty array is returned.
- Parse source with a non-function export (`export const FOO = 42`). Verify it is not included.

---

### Step 5: Implement artifact extractor

**What to do:** Create `src/task-analysis/extractors/artifacts.ts` exporting `extractArtifactReads(ast: BabelFile, sourceCode?: string): { reads: ArtifactRead[]; unresolvedReads: UnresolvedRead[] }`, `extractArtifactWrites(ast: BabelFile, sourceCode?: string): { writes: ArtifactWrite[]; unresolvedWrites: UnresolvedWrite[] }`, and `extractCodeContext(path: NodePath, sourceCode: string): string`.

**Why:** Artifact extraction identifies all file I/O in a task. Satisfies acceptance criteria 13–22.

**Type signatures:**

```typescript
import type { File as BabelFile } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { ArtifactRead, ArtifactWrite, UnresolvedRead, UnresolvedWrite } from "../types.ts";

export function extractArtifactReads(
  ast: BabelFile,
  sourceCode?: string
): { reads: ArtifactRead[]; unresolvedReads: UnresolvedRead[] }

export function extractArtifactWrites(
  ast: BabelFile,
  sourceCode?: string
): { writes: ArtifactWrite[]; unresolvedWrites: UnresolvedWrite[] }

export function extractCodeContext(path: NodePath, sourceCode: string): string
```

**Implementation details:**
- Use `@babel/traverse` to visit `CallExpression` nodes.
- Match calls where the callee is a `MemberExpression` with object `io` and property `readArtifact` (or `writeArtifact`).
- For each matched call:
  - Call `getStageName(path)`. If `null`, throw an error with source location.
  - Extract the first argument node.
  - If it's a `StringLiteral`: use `.value` as `fileName` → resolved entry.
  - If it's a `TemplateLiteral` with no expressions: join cooked quasis → resolved entry.
  - If it's a `TemplateLiteral` with expressions: use `@babel/generator` to convert to source, strip backticks → resolved entry (placed in reads/writes, not unresolved).
  - Otherwise: use `@babel/generator` to get the expression source string → unresolved entry. Call `extractCodeContext` for the `codeContext` field.
  - For reads: set `required = !isInsideTryCatch(path)`.
  - Store source `location` from the argument node's `loc.start`.
- `extractCodeContext`: Split `sourceCode` by newlines. Get the node's start line from `path.node.loc.start.line`. Extract lines from `max(0, line - 3)` to `min(totalLines, line + 2)` (2 before, the line itself, 2 after — up to 5 lines total). Return joined with newlines. Return empty string if `sourceCode` or `loc` is unavailable.

**Test:** `src/task-analysis/__tests__/extractors-artifacts.test.ts`
- Parse source: `export function s() { io.readArtifact("data.json") }`. Verify `extractArtifactReads` returns one read with `fileName: "data.json"`, `stage: "s"`, `required: true`.
- Parse source with `io.readArtifact` inside a try/catch. Verify `required: false`.
- Parse source with `` io.writeArtifact(`output.json`) `` (template literal, no expressions). Verify resolved write with `fileName: "output.json"`.
- Parse source with `` io.readArtifact(`file-${name}.json`) `` (template with expression). Verify it appears in `reads` (not `unresolvedReads`) with `${name}` in the fileName.
- Parse source with `io.writeArtifact(dynamicVar)`. Verify it appears in `unresolvedWrites` with `expression` and `codeContext`.
- Parse source with `io.readArtifact("x")` outside an exported function. Verify it throws.
- Test `extractCodeContext` returns surrounding lines and empty string when source is unavailable.

---

### Step 6: Implement LLM call extractor

**What to do:** Create `src/task-analysis/extractors/llm-calls.ts` exporting `extractLLMCalls(ast: BabelFile): ModelCall[]`.

**Why:** LLM call extraction identifies all model invocations in a task. Satisfies acceptance criteria 23–28.

**Type signatures:**

```typescript
import type { File as BabelFile } from "@babel/types";
import type { ModelCall } from "../types.ts";

export function extractLLMCalls(ast: BabelFile): ModelCall[]
```

**Implementation details:**
- Use `@babel/traverse` to visit `CallExpression` nodes.
- Detect three patterns:
  1. **Direct access:** `llm.provider.method()` — callee is a `MemberExpression` where `object` is a `MemberExpression` with `object.name === "llm"`. Extract `provider` from `object.property.name`, `method` from `property.name`.
  2. **Variable destructuring:** `const { provider } = llm; provider.method()` — callee is a `MemberExpression` where `object` is an `Identifier`. Check the scope binding for that identifier. If the binding is a `VariableDeclarator` whose `init` is an `Identifier` with `name === "llm"` and the binding pattern is an `ObjectPattern`, then the destructured property name is the `provider`. Extract `method` from the call's `property.name`.
  3. **Parameter destructuring:** `({ llm: { provider } }) => provider.method()` — callee is a `MemberExpression` where `object` is an `Identifier`. Check the scope binding. If the binding is inside an `ObjectPattern` parameter, walk up to find a parent `ObjectProperty` with key `"llm"`. The destructured property name is the `provider`.
- For each detected call:
  - Call `getStageName(path)`. If `null`, throw with source location.
  - Create a `ModelCall` with `provider`, `method`, `stage`.
- Return all collected `ModelCall` objects.

**Test:** `src/task-analysis/__tests__/extractors-llm-calls.test.ts`
- Parse: `export function s() { llm.deepseek.chat({}) }`. Verify one `ModelCall` with `provider: "deepseek"`, `method: "chat"`, `stage: "s"`.
- Parse: `export function s() { const { openai } = llm; openai.gpt5({}) }`. Verify `provider: "openai"`, `method: "gpt5"`.
- Parse: `export function s({ llm: { anthropic } }) { anthropic.sonnet45({}) }`. Verify `provider: "anthropic"`, `method: "sonnet45"`.
- Parse: `const deepseek = {}; deepseek.chat({})` outside an export. Verify it does NOT produce a `ModelCall` (not an LLM call — different scope).
- Parse with `llm.provider.method()` outside an exported function. Verify it throws.

---

### Step 7: Implement the main entry point (`analyzeTask`)

**What to do:** Create `src/task-analysis/index.ts` exporting `analyzeTask(code: string, taskFilePath?: string | null): TaskAnalysis` and re-exporting all public functions from submodules.

**Why:** This is the primary public API that composes parser + extractors. Satisfies acceptance criteria 1–4.

**Type signatures:**

```typescript
import type { TaskAnalysis } from "./types.ts";

export function analyzeTask(code: string, taskFilePath?: string | null): TaskAnalysis

// Re-exports
export { parseTaskSource } from "./parser.ts";
export { extractStages } from "./extractors/stages.ts";
export { extractArtifactReads, extractArtifactWrites, extractCodeContext } from "./extractors/artifacts.ts";
export { extractLLMCalls } from "./extractors/llm-calls.ts";
export { deduceArtifactSchema } from "./enrichers/schema-deducer.ts";
export { resolveArtifactReference } from "./enrichers/artifact-resolver.ts";
export { writeSchemaFiles } from "./enrichers/schema-writer.ts";
export { writeAnalysisFile } from "./enrichers/analysis-writer.ts";
export { isInsideTryCatch, getStageName } from "./utils/ast.ts";
export type * from "./types.ts";
```

**Implementation details:**
- Call `parseTaskSource(code)` to get the AST.
- Call `extractStages(ast)` to get sorted stages.
- Call `extractArtifactReads(ast, code)` to get `{ reads, unresolvedReads }`.
- Call `extractArtifactWrites(ast, code)` to get `{ writes, unresolvedWrites }`.
- Call `extractLLMCalls(ast)` to get `ModelCall[]`.
- Assemble and return:
  ```typescript
  {
    taskFilePath: taskFilePath ?? null,
    stages,
    artifacts: { reads, writes, unresolvedReads, unresolvedWrites },
    models
  }
  ```

**Test:** `src/task-analysis/__tests__/index.test.ts`
- Parse a complete task file with multiple stages, artifact reads/writes, and LLM calls. Verify the returned `TaskAnalysis` contains all expected entries.
- Verify `taskFilePath` is `null` when not provided.
- Verify `taskFilePath` is the provided path when given.
- Verify that parse errors propagate through `analyzeTask`.

---

### Step 8: Implement schema deducer

**What to do:** Create `src/task-analysis/enrichers/schema-deducer.ts` exporting `deduceArtifactSchema(taskCode: string, artifact: ArtifactDescriptor): Promise<DeducedSchema>`.

**Why:** LLM-powered schema inference for artifacts. Satisfies acceptance criteria 31–34.

**Type signatures:**

```typescript
import type { ArtifactDescriptor, DeducedSchema } from "../types.ts";

export async function deduceArtifactSchema(
  taskCode: string,
  artifact: ArtifactDescriptor
): Promise<DeducedSchema>
```

**Implementation details:**
- Import `chat` from `src/llm/index.ts`.
- Construct a prompt asking the LLM to analyze the task code and infer a JSON Schema Draft-07 for the given artifact. Include the `taskCode`, `artifact.fileName`, and `artifact.stage` in the prompt.
- Call `chat({ provider: "deepseek", model: "deepseek-chat", messages, temperature: 0, responseFormat: { type: "json_object" } })`.
- The `chat()` gateway returns `{ content: unknown }`. Assert `typeof content === "object" && content !== null`; throw if not (unexpected gateway behavior — content should be pre-parsed when `responseFormat` is JSON mode).
- Validate `content` fields: `schema` (non-null plain object), `example` (non-null plain object), and `reasoning` (string). Throw on violations. Specifically, `example` must satisfy `typeof example === "object" && example !== null && !Array.isArray(example)` — primitives and arrays are rejected.
- Create a module-level `Ajv` instance with formats enabled (`addFormats(new Ajv())`).
- Before compiling the schema, check if a schema with the same `$id` already exists and remove it.
- Compile the schema with Ajv and validate `example` against it. Throw if validation fails.
- Return `{ schema, example, reasoning }`.

**Test:** `src/task-analysis/__tests__/enrichers-schema-deducer.test.ts`
- Mock the `chat` function to return a valid response with a schema, example, and reasoning. Call `deduceArtifactSchema`. Verify it returns the expected `DeducedSchema`.
- Mock `chat` to return an invalid response (missing `schema`). Verify it throws.
- Mock `chat` to return a schema and an example that does NOT validate against the schema. Verify it throws.
- Mock `chat` to return an `example` that is a primitive (e.g., `"just a string"`) or an array. Verify it throws before Ajv validation (rejected as non-object).
- Verify that calling twice with the same `$id` does not throw "schema already exists".

---

### Step 9: Implement artifact resolver

**What to do:** Create `src/task-analysis/enrichers/artifact-resolver.ts` exporting `resolveArtifactReference(taskCode: string, unresolvedArtifact: UnresolvedArtifactDescriptor, availableArtifacts: string[]): Promise<ArtifactResolution>`.

**Why:** LLM-powered resolution of dynamic artifact references. Satisfies acceptance criteria 35–37.

**Type signatures:**

```typescript
import type { UnresolvedArtifactDescriptor, ArtifactResolution } from "../types.ts";

export async function resolveArtifactReference(
  taskCode: string,
  unresolvedArtifact: UnresolvedArtifactDescriptor,
  availableArtifacts: string[]
): Promise<ArtifactResolution>
```

**Implementation details:**
- Import `chat` from `src/llm/index.ts`.
- Construct a prompt asking the LLM to resolve the dynamic expression to one of the `availableArtifacts`.
- Call `chat({ provider: "deepseek", messages, temperature: 0, responseFormat: { type: "json_object" } })`.
- The `chat()` gateway returns `{ content: unknown }`. The contract for this path is: `content` is always a parsed object when `responseFormat` is `{ type: "json_object" }` — the gateway normalizes string-vs-object internally. Assert `typeof content === "object" && content !== null`; throw otherwise (unexpected gateway behavior).
- Extract `resolvedFileName`, `confidence`, `reasoning` from `content`.
- Sanitize `confidence`: if `confidence` is not a finite number, or is outside `[0, 1]`, clamp it — values below 0 become 0, values above 1 become 1, `NaN`/`Infinity` become 0.
- Sanitize filename: if `resolvedFileName` is not in `availableArtifacts`, set `resolvedFileName = null` and `confidence = 0`.
- Wrap the entire function body in a try/catch. On any error, return `{ resolvedFileName: null, confidence: 0, reasoning: "Failed to analyze artifact reference" }`.

**Test:** `src/task-analysis/__tests__/enrichers-artifact-resolver.test.ts`
- Mock `chat` to return `{ resolvedFileName: "data.json", confidence: 0.9, reasoning: "..." }` where `"data.json"` is in `availableArtifacts`. Verify the result is returned as-is.
- Mock `chat` to return `{ resolvedFileName: "hallucinated.json", confidence: 0.8, reasoning: "..." }` where `"hallucinated.json"` is NOT in `availableArtifacts`. Verify `resolvedFileName` is `null` and `confidence` is `0`.
- Mock `chat` to return `{ resolvedFileName: "data.json", confidence: 7, reasoning: "..." }` where `"data.json"` IS in `availableArtifacts`. Verify `confidence` is clamped to `1`.
- Mock `chat` to return `{ resolvedFileName: "data.json", confidence: NaN, reasoning: "..." }`. Verify `confidence` is forced to `0`.
- Mock `chat` to return `{ resolvedFileName: "data.json", confidence: -1, reasoning: "..." }`. Verify `confidence` is clamped to `0`.
- Mock `chat` to return `{ content: '{"resolvedFileName":"x.json"}' }` (a raw string instead of parsed object). Verify the function returns the fallback result (the string content triggers the assertion, which is caught by the blanket catch).
- Mock `chat` to throw an error. Verify the function returns the fallback `{ resolvedFileName: null, confidence: 0, reasoning: "Failed to analyze artifact reference" }` and does NOT throw.

---

### Step 10: Implement schema writer

**What to do:** Create `src/task-analysis/enrichers/schema-writer.ts` exporting `writeSchemaFiles(pipelinePath: string, artifactName: string, deducedData: DeducedSchema): Promise<void>`.

**Why:** Persists deduced schema data to disk. Satisfies acceptance criteria 41–44.

**Type signatures:**

```typescript
import type { DeducedSchema } from "../types.ts";

export async function writeSchemaFiles(
  pipelinePath: string,
  artifactName: string,
  deducedData: DeducedSchema
): Promise<void>
```

**Implementation details:**
- Validate `deducedData`: `schema` must be a non-null plain object, `example` must be a non-null plain object (`typeof === "object" && !Array.isArray`), `reasoning` must be a string. Throw on violations.
- Derive `baseName` by stripping the file extension from `artifactName` using `path.parse(artifactName).name`.
- Create `{pipelinePath}/schemas/` directory with `mkdir(path, { recursive: true })`.
- Write three files using `Bun.write`:
  - `{baseName}.schema.json`: `JSON.stringify(deducedData.schema, null, 2)`
  - `{baseName}.sample.json`: `JSON.stringify(deducedData.example, null, 2)`
  - `{baseName}.meta.json`: `JSON.stringify({ source: "llm-deduction", generatedAt: new Date().toISOString(), reasoning: deducedData.reasoning }, null, 2)`

**Test:** `src/task-analysis/__tests__/enrichers-schema-writer.test.ts`
- Call `writeSchemaFiles` with a temp directory, `"output.json"`, and valid deduced data. Verify three files exist: `output.schema.json`, `output.sample.json`, `output.meta.json`. Verify schema file contains the schema JSON. Verify meta file has `source: "llm-deduction"` and a `generatedAt` timestamp.
- Call with `deducedData` missing `schema`. Verify it throws.
- Call with `deducedData` where `reasoning` is not a string. Verify it throws.

---

### Step 11: Implement analysis writer

**What to do:** Create `src/task-analysis/enrichers/analysis-writer.ts` exporting `writeAnalysisFile(pipelinePath: string, taskName: string, analysisData: TaskAnalysis): Promise<void>`.

**Why:** Persists `TaskAnalysis` to disk. Satisfies acceptance criteria 38–40, 48.

**Type signatures:**

```typescript
import type { TaskAnalysis } from "../types.ts";

export async function writeAnalysisFile(
  pipelinePath: string,
  taskName: string,
  analysisData: TaskAnalysis
): Promise<void>
```

**Implementation details:**
- Validate `analysisData` eagerly before any I/O:
  - `taskFilePath` must be a non-null, non-empty string. Throw if null, undefined, or empty.
  - `stages` must be an array. Throw if not.
  - `models` must be an array. Throw if not.
  - `artifacts` must be an object with `reads` and `writes` arrays. Throw if not.
  - If `artifacts.unresolvedReads` or `artifacts.unresolvedWrites` are present, they must be arrays.
- Create `{pipelinePath}/analysis/` directory with `mkdir(path, { recursive: true })`.
- Construct the persisted object: `{ ...analysisData, analyzedAt: new Date().toISOString() }`.
- Write to `{pipelinePath}/analysis/{taskName}.analysis.json` using `Bun.write` with `JSON.stringify(data, null, 2)`.

**Test:** `src/task-analysis/__tests__/enrichers-analysis-writer.test.ts`
- Call `writeAnalysisFile` with a temp directory, `"research"`, and a valid `TaskAnalysis` (with `taskFilePath` set to a non-null string). Verify `research.analysis.json` exists and contains `analyzedAt` timestamp and all analysis fields.
- Call with `taskFilePath: null`. Verify it throws before creating any file.
- Call with `stages: "not-an-array"`. Verify it throws.
- Call with `artifacts` missing `reads`. Verify it throws.
