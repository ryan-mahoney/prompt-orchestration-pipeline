const TEXT_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/xml",
  "image/svg+xml",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

export const MIME_MAP = Object.freeze({
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  map: "application/json",
  md: "text/markdown",
  mjs: "application/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ts: "text/plain",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml",
  yaml: "text/plain",
  yml: "text/plain",
  zip: "application/zip",
} as const satisfies Record<string, string>);

export function getMimeType(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.at(-1) : "";
  return (ext && MIME_MAP[ext as keyof typeof MIME_MAP]) || "application/octet-stream";
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_TYPES.has(mime);
}
