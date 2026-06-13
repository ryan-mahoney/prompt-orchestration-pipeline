import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const ROUTER_PATH = path.join(ROOT, "src/ui/server/router.ts");
const DOCS_PATH = path.join(ROOT, "docs/http-api.md");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const EXPECTED_ROUTE_COUNT = 24;

function extractRoutes(source: string): Array<{ method: string; path: string }> {
  const pattern = /addRoute\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g;
  const routes: Array<{ method: string; path: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    routes.push({ method: match[1]!, path: match[2]! });
  }
  return routes;
}

describe("http-api.md coverage", () => {
  it("documents every route registered in router.ts", async () => {
    const [routerSource, docsContent] = await Promise.all([
      readFile(ROUTER_PATH, "utf-8"),
      readFile(DOCS_PATH, "utf-8"),
    ]);

    const routes = extractRoutes(routerSource);
    expect(routes).toHaveLength(EXPECTED_ROUTE_COUNT);

    const missing: string[] = [];
    for (const route of routes) {
      const escaped = route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\`${route.method}\`\\s*\\|\\s*\`${escaped}\``);
      if (!pattern.test(docsContent)) {
        missing.push(`${route.method} ${route.path}`);
      }
    }

    expect(missing, `Missing routes in docs/http-api.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes docs/http-api.md in package.json files array", async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_PATH, "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("docs/http-api.md");
  });
});
