import traverse from "@babel/traverse";
import generate from "@babel/generator";
import type { File as BabelFile } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type {
  ArtifactRead,
  ArtifactWrite,
  UnresolvedRead,
  UnresolvedWrite,
} from "../types.ts";
import { getStageName, isInsideTryCatch } from "../utils/ast.ts";

export function extractCodeContext(
  path: NodePath,
  sourceCode: string
): string {
  if (!sourceCode || !path.node.loc) return "";
  const lines = sourceCode.split("\n");
  const line = path.node.loc.start.line - 1; // convert to 0-based
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 3);
  return lines.slice(start, end).join("\n");
}

function resolveFileName(
  argNode: import("@babel/types").Expression | import("@babel/types").SpreadElement
): string | null {
  if (argNode.type === "StringLiteral") {
    return argNode.value;
  }
  if (argNode.type === "TemplateLiteral") {
    if (argNode.expressions.length === 0) {
      return argNode.quasis.map((q) => q.value.cooked ?? "").join("");
    }
    // Template with expressions: generate source text, strip backticks
    const src = generate(argNode).code;
    return src.replace(/^`|`$/g, "");
  }
  return null;
}

export function extractArtifactReads(
  ast: BabelFile,
  sourceCode?: string
): { reads: ArtifactRead[]; unresolvedReads: UnresolvedRead[] } {
  const reads: ArtifactRead[] = [];
  const unresolvedReads: UnresolvedRead[] = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;
      if (
        callee.type !== "MemberExpression" ||
        callee.object.type !== "Identifier" ||
        callee.object.name !== "io" ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "readArtifact"
      )
        return;

      const stage = getStageName(path);
      if (stage === null) {
        const loc = path.node.loc;
        throw new Error(
          `io.readArtifact call at line ${loc?.start.line ?? "unknown"}, column ${loc?.start.column ?? "unknown"} is not inside an exported function`
        );
      }

      const arg = path.node.arguments[0];
      if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return;

      const required = !isInsideTryCatch(path);
      const fileName = resolveFileName(arg);

      if (fileName !== null) {
        reads.push({ fileName, stage, required });
      } else {
        const expression = generate(arg).code;
        const codeContext = sourceCode
          ? extractCodeContext(path, sourceCode)
          : "";
        const location = {
          line: arg.loc?.start.line ?? 0,
          column: arg.loc?.start.column ?? 0,
        };
        unresolvedReads.push({ expression, codeContext, stage, required, location });
      }
    },
  });

  return { reads, unresolvedReads };
}

export function extractArtifactWrites(
  ast: BabelFile,
  sourceCode?: string
): { writes: ArtifactWrite[]; unresolvedWrites: UnresolvedWrite[] } {
  const writes: ArtifactWrite[] = [];
  const unresolvedWrites: UnresolvedWrite[] = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;
      if (
        callee.type !== "MemberExpression" ||
        callee.object.type !== "Identifier" ||
        callee.object.name !== "io" ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "writeArtifact"
      )
        return;

      const stage = getStageName(path);
      if (stage === null) {
        const loc = path.node.loc;
        throw new Error(
          `io.writeArtifact call at line ${loc?.start.line ?? "unknown"}, column ${loc?.start.column ?? "unknown"} is not inside an exported function`
        );
      }

      const arg = path.node.arguments[0];
      if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return;

      const fileName = resolveFileName(arg);

      if (fileName !== null) {
        writes.push({ fileName, stage });
      } else {
        const expression = generate(arg).code;
        const codeContext = sourceCode
          ? extractCodeContext(path, sourceCode)
          : "";
        const location = {
          line: arg.loc?.start.line ?? 0,
          column: arg.loc?.start.column ?? 0,
        };
        unresolvedWrites.push({ expression, codeContext, stage, location });
      }
    },
  });

  return { writes, unresolvedWrites };
}
