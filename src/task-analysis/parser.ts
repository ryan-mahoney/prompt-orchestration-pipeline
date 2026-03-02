import { parse } from "@babel/parser";
import type { File as BabelFile } from "@babel/types";

export function parseTaskSource(code: string): BabelFile {
  try {
    return parse(code, { sourceType: "module", plugins: ["jsx"] });
  } catch (err) {
    const loc =
      err != null &&
      typeof err === "object" &&
      "loc" in err &&
      err.loc != null &&
      typeof err.loc === "object" &&
      "line" in err.loc &&
      "column" in err.loc
        ? `line ${err.loc.line}, column ${err.loc.column}`
        : "unknown location";
    throw new Error(`Syntax error at ${loc}`, { cause: err });
  }
}
