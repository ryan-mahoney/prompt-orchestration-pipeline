import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractSeedZip } from "../zip-utils";

describe("zip-utils", () => {
  it("extracts seed data and artifacts", async () => {
    const zip = zipSync({
      "seed.json": new TextEncoder().encode('{"name":"seed"}'),
      "artifacts/file.txt": new TextEncoder().encode("hello"),
    });

    await expect(extractSeedZip(zip)).resolves.toEqual({
      seedObject: { name: "seed" },
      artifacts: [{ filename: "artifacts/file.txt", content: expect.any(Uint8Array) }],
    });
  });

  it("throws when seed.json is missing", async () => {
    const zip = zipSync({ "artifact.txt": new TextEncoder().encode("x") });
    await expect(extractSeedZip(zip)).rejects.toThrow(/seed\.json/);
  });
});
