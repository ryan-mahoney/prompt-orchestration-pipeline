import { describe, expect, it } from "vitest";

import { handleMeta, PROTOCOL_VERSION } from "../meta-endpoint";
import pkg from "../../../../../package.json";

describe("handleMeta", () => {
  it("returns 200 with ok:true and protocolVersion", async () => {
    const res = handleMeta();
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data["protocolVersion"]).toBe(PROTOCOL_VERSION);
  });

  it("serves the exact package.json version (drift guard)", async () => {
    const res = handleMeta();
    const body = await res.json() as { data: Record<string, unknown> };

    expect(body.data["version"]).toBe(pkg.version);
  });

  it("serves the exact package.json name", async () => {
    const res = handleMeta();
    const body = await res.json() as { data: Record<string, unknown> };

    expect(body.data["name"]).toBe(pkg.name);
  });
});
