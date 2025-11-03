import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

describe("Package Configuration", () => {
  it("should include UI dist assets in published package", () => {
    // Test that package.json includes src which covers src/ui/dist
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.files).toContain("src");

    // Verify dist directory exists with built assets
    const dryRunOutput = execSync("npm pack --dry-run 2>&1", {
      encoding: "utf8",
    });

    // Check that the built UI assets are included in the tarball
    // Look for the npm notice lines that show the file sizes
    expect(dryRunOutput).toMatch(/npm notice.*src\/ui\/dist\/index\.html/);
    expect(dryRunOutput).toMatch(/npm notice.*src\/ui\/dist\/assets\/.*\.js/);
    expect(dryRunOutput).toMatch(/npm notice.*src\/ui\/dist\/assets\/.*\.css/);
  });

  it("should have prepack script that builds UI", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.scripts).toHaveProperty("prepack");
    expect(packageJson.scripts.prepack).toBe("npm run ui:build");
  });
});
