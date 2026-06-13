import { describe, expect, it } from "vitest";

import {
  corsHeadersFor,
  isLoopbackHost,
  isOriginAllowed,
  isSameOrigin,
  parseCorsConfig,
  shouldRejectMutation,
} from "../cors";

describe("parseCorsConfig", () => {
  it("trims and drops empties", () => {
    expect(parseCorsConfig("a, b ,", false)).toEqual({ origins: ["a", "b"], allowNullOrigin: false });
  });

  it("drops the literal null token", () => {
    expect(parseCorsConfig("x,null,y", false)).toEqual({ origins: ["x", "y"], allowNullOrigin: false });
  });

  it("returns empty origins for undefined input", () => {
    expect(parseCorsConfig(undefined, true)).toEqual({ origins: [], allowNullOrigin: true });
  });
});

describe("isLoopbackHost", () => {
  it("accepts bare loopback names", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("Localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("accepts loopback names with ports", () => {
    expect(isLoopbackHost("localhost:4000")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:80")).toBe(true);
    expect(isLoopbackHost("[::1]:4000")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("evil.com")).toBe(false);
    expect(isLoopbackHost("app.internal:4000")).toBe(false);
  });

  it("rejects null and empty", () => {
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("matches when http authority equals host header", () => {
    expect(isSameOrigin("http://localhost:4000", "localhost:4000")).toBe(true);
  });

  it("rejects mismatched port", () => {
    expect(isSameOrigin("http://localhost:4000", "localhost:4001")).toBe(false);
  });

  it("rejects https origin", () => {
    expect(isSameOrigin("https://localhost:4000", "localhost:4000")).toBe(false);
  });

  it("rejects null host header", () => {
    expect(isSameOrigin("http://localhost:4000", null)).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  it("matches exact origin", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(isOriginAllowed("https://app.example", cfg)).toBe(true);
    expect(isOriginAllowed("https://evil.example", cfg)).toBe(false);
  });

  it("localhost keyword matches loopback origins on any port", () => {
    const cfg = { origins: ["localhost"], allowNullOrigin: false };
    expect(isOriginAllowed("http://localhost:5173", cfg)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:3000", cfg)).toBe(true);
    expect(isOriginAllowed("http://[::1]:4000", cfg)).toBe(true);
    expect(isOriginAllowed("https://app.example", cfg)).toBe(false);
  });

  it("null origin allowed only when allowNullOrigin is true", () => {
    const denied = { origins: [], allowNullOrigin: false };
    const allowed = { origins: [], allowNullOrigin: true };
    expect(isOriginAllowed("null", denied)).toBe(false);
    expect(isOriginAllowed("null", allowed)).toBe(true);
  });
});

describe("corsHeadersFor", () => {
  it("returns null for absent origin", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(corsHeadersFor(null, "localhost:4000", cfg)).toBe(null);
  });

  it("returns null for same-origin", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(corsHeadersFor("http://localhost:4000", "localhost:4000", cfg)).toBe(null);
  });

  it("returns ACAO and Vary for allowed cross-origin", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(corsHeadersFor("https://app.example", "localhost:4000", cfg)).toEqual({
      "Access-Control-Allow-Origin": "https://app.example",
      "Vary": "Origin",
    });
  });

  it("returns null for disallowed cross-origin", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(corsHeadersFor("https://evil.example", "localhost:4000", cfg)).toBe(null);
  });

  it("never includes Access-Control-Allow-Credentials", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    const headers = corsHeadersFor("https://app.example", "localhost:4000", cfg);
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });
});

describe("shouldRejectMutation", () => {
  it("rejects cross-origin disallowed POST to /api path", () => {
    const cfg = { origins: ["https://app.example"], allowNullOrigin: false };
    expect(shouldRejectMutation("POST", "/api/x", "https://evil.example", "localhost:4000", cfg)).toBe(true);
  });

  it("allows GET regardless of origin", () => {
    const cfg = { origins: [], allowNullOrigin: false };
    expect(shouldRejectMutation("GET", "/api/x", "https://evil.example", "localhost:4000", cfg)).toBe(false);
  });

  it("allows same-origin POST", () => {
    const cfg = { origins: [], allowNullOrigin: false };
    expect(shouldRejectMutation("POST", "/api/x", "http://localhost:4000", "localhost:4000", cfg)).toBe(false);
  });

  it("allows POST with no origin (non-browser caller)", () => {
    const cfg = { origins: [], allowNullOrigin: false };
    expect(shouldRejectMutation("POST", "/api/x", null, "localhost:4000", cfg)).toBe(false);
  });

  it("allows POST to non-api path", () => {
    const cfg = { origins: [], allowNullOrigin: false };
    expect(shouldRejectMutation("POST", "/other", "https://evil.example", "localhost:4000", cfg)).toBe(false);
  });
});
