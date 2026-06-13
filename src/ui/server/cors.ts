export const PREFLIGHT_ALLOW_METHODS = "GET, POST, OPTIONS";
export const PREFLIGHT_ALLOW_HEADERS = "Content-Type";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CorsConfig {
  origins: string[];
  allowNullOrigin: boolean;
}

export function parseCorsConfig(
  rawOrigins: string | undefined,
  allowNullOrigin: boolean,
): CorsConfig {
  const origins = (rawOrigins ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "null");
  return { origins, allowNullOrigin };
}

export function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  if (hostHeader.startsWith("[")) {
    hostname = hostHeader.slice(1, hostHeader.indexOf("]"));
  } else if (hostHeader.indexOf(":") !== hostHeader.lastIndexOf(":")) {
    hostname = hostHeader;
  } else if (hostHeader.includes(":")) {
    hostname = hostHeader.slice(0, hostHeader.lastIndexOf(":"));
  } else {
    hostname = hostHeader;
  }
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isSameOrigin(origin: string, hostHeader: string | null): boolean {
  if (!hostHeader || !origin.startsWith("http://")) return false;
  const authority = origin.slice("http://".length);
  return authority === hostHeader;
}

export function isOriginAllowed(origin: string, cfg: CorsConfig): boolean {
  if (origin === "null") return cfg.allowNullOrigin;
  if (cfg.origins.includes(origin)) return true;
  if (cfg.origins.includes("localhost")) {
    return (
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://[::1]:")
    );
  }
  return false;
}

export function corsHeadersFor(
  origin: string | null,
  hostHeader: string | null,
  cfg: CorsConfig,
): Record<string, string> | null {
  if (!origin) return null;
  if (isSameOrigin(origin, hostHeader)) return null;
  if (isOriginAllowed(origin, cfg)) {
    return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
  }
  return null;
}

export function shouldRejectMutation(
  method: string,
  pathname: string,
  origin: string | null,
  hostHeader: string | null,
  cfg: CorsConfig,
): boolean {
  if (!origin) return false;
  if (!MUTATING_METHODS.has(method.toUpperCase())) return false;
  if (!pathname.startsWith("/api/")) return false;
  if (isSameOrigin(origin, hostHeader)) return false;
  if (isOriginAllowed(origin, cfg)) return false;
  return true;
}
