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
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = new Uint8Array(await req.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw badRequest(`request body exceeds ${maxBytes} bytes`);
  }
  return buffer;
}

export async function parseMultipartFormData(
  req: Request,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<{ fields: Record<string, string>; files: MultipartFile[] }> {
  const contentType = req.headers.get("content-type");
  if (
    !contentType ||
    !contentType.toLowerCase().includes("multipart/form-data")
  ) {
    throw badRequest("expected multipart/form-data content-type");
  }

  const raw = await readRawBody(req, maxBytes); // enforces the size cap on actual bytes
  const form = await new Response(raw, {
    headers: { "content-type": contentType },
  }).formData();

  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  for (const name of new Set(form.keys())) {
    for (const value of form.getAll(name)) {
      if (typeof value === "string") {
        fields[name] = value;
      } else {
        files.push({
          filename: value.name,
          contentType: value.type || "application/octet-stream",
          content: new Uint8Array(await value.arrayBuffer()),
        });
      }
    }
  }
  return { fields, files };
}
