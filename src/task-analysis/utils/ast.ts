import type { NodePath } from "@babel/traverse";
import type {
  TryStatement,
  ExportNamedDeclaration,
  FunctionDeclaration,
  VariableDeclaration,
} from "@babel/types";

export function isInsideTryCatch(path: NodePath): boolean {
  let current: NodePath | null = path.parentPath;
  while (current !== null) {
    if (current.isTryStatement()) {
      const tryNode = current.node as TryStatement;
      const blockPath = current.get("block") as NodePath;
      if (blockPath.node === tryNode.block) {
        return true;
      }
    }
    current = current.parentPath;
  }
  return false;
}

export function getStageName(path: NodePath): string | null {
  let current: NodePath | null = path.parentPath;
  while (current !== null) {
    if (current.isExportNamedDeclaration()) {
      const node = current.node as ExportNamedDeclaration;
      const decl = node.declaration;
      if (decl === null || decl === undefined) return null;
      if (decl.type === "FunctionDeclaration") {
        return (decl as FunctionDeclaration).id?.name ?? null;
      }
      if (decl.type === "VariableDeclaration") {
        const declarator = (decl as VariableDeclaration).declarations[0];
        if (declarator?.id.type === "Identifier") {
          return declarator.id.name;
        }
      }
      return null;
    }
    current = current.parentPath;
  }
  return null;
}
