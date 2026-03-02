import traverse from "@babel/traverse";
import type { File as BabelFile } from "@babel/types";
import type { Stage } from "../types.ts";

export function extractStages(ast: BabelFile): Stage[] {
  const stages: Stage[] = [];

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const { declaration } = path.node;
      if (declaration == null) return;

      if (declaration.type === "FunctionDeclaration") {
        const name = declaration.id?.name;
        if (name == null) return;
        stages.push({
          name,
          order: path.node.loc?.start.line ?? 0,
          isAsync: declaration.async ?? false,
        });
        return;
      }

      if (declaration.type === "VariableDeclaration") {
        const declarator = declaration.declarations[0];
        if (declarator == null) return;
        if (declarator.id.type !== "Identifier") return;
        const init = declarator.init;
        if (
          init == null ||
          (init.type !== "ArrowFunctionExpression" &&
            init.type !== "FunctionExpression")
        )
          return;
        stages.push({
          name: declarator.id.name,
          order: path.node.loc?.start.line ?? 0,
          isAsync: init.async ?? false,
        });
      }
    },
  });

  return stages.sort((a, b) => a.order - b.order);
}
