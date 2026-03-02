export interface MultipartFile {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function badRequest(message: string): Error {
  return new Error(message);
}

export function sendJson(statusCode: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

export async function readRawBody(
  req: Request,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(await req.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw badRequest(`request body exceeds ${maxBytes} bytes`);
  }
  return buffer;
}

function parseHeaders(block: string): Record<string, string> {
  return Object.fromEntries(
    block
      .split("\r\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [name, ...rest] = line.split(":");
        if (name === undefined) return [];
        return [[name.trim().toLowerCase(), rest.join(":").trim()] as const];
      }),
  );
}

function getBoundary(contentType: string | null): string {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!match) throw badRequest("multipart boundary is required");
  return match[1] ?? match[2]!;
}

export async function parseMultipartFormData(
  req: Request,
): Promise<{ fields: Record<string, string>; files: MultipartFile[] }> {
  const boundary = getBoundary(req.headers.get("content-type"));
  const body = new TextDecoder().decode(await readRawBody(req));
  const parts = body.split(`--${boundary}`).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  for (const rawPart of parts) {
    const part = rawPart.trimStart().replace(/\r\n$/, "");
    const separator = part.indexOf("\r\n\r\n");
    if (separator < 0) continue;

    const headerBlock = part.slice(0, separator);
    const contentBlock = part.slice(separator + 4);
    const headers = parseHeaders(headerBlock);
    const disposition = headers["content-disposition"];
    if (!disposition) continue;

    const nameMatch = /name="([^"]+)"/.exec(disposition);
    const fieldName = nameMatch?.[1];
    if (!fieldName) continue;
    const filenameMatch = /filename="([^"]*)"/.exec(disposition);

    if (!filenameMatch) {
      fields[fieldName] = contentBlock;
      continue;
    }

    const filename = filenameMatch[1];
    if (filename === undefined) continue;
    files.push({
      filename,
      contentType: headers["content-type"] ?? "application/octet-stream",
      content: new TextEncoder().encode(contentBlock),
    });
  }

  return { fields, files };
}
